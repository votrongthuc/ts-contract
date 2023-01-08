// Find all our documentation at https://docs.near.org
import { NearBindgen, call, view, initialize, LookupMap, UnorderedMap, UnorderedSet, NearPromise, assert, near, } from 'near-sdk-js';
import { AccountId } from 'near-sdk-js/lib/types';
import { serialize } from 'near-sdk-js/lib/utils';

type Option<T> = T | null;
type TokenId = string;
const GAS_FOR_NFT_APPROVE = 20_000_000_000_000n;
function assert_at_least_one_yocto(): void {
  assert(
    near.attachedDeposit() >= 1n,
    "Requires attached deposit of at least 1 yoctoNEAR"
  );
}

function assert_one_yocto(): void {
  assert(
    near.attachedDeposit() === 1n,
    "Requires attached deposit of 1 yoctoNEAR"
  );
}

function refund_storage_deposit(
  account_id: AccountId,
  storage_released: number
): void {
  const promise_id = near.promiseBatchCreate(account_id);
  near.promiseBatchActionTransfer(
    promise_id,
    BigInt(storage_released) * near.storageByteCost()
  );
  near.promiseReturn(promise_id);
}

function expect_token_found<T>(option: Option<T>): T {
  if (option === null) {
    throw new Error("Token not found");
  }
  return option;
}

function expect_approval<T>(option: Option<T>): T {
  if (option === null) {
    throw new Error("next_approval_by_id must be set for approval ext");
  }
  return option;
}

function refund_deposit_to_account(
  storage_used: bigint,
  account_id: AccountId
): void {
  const required_cost = near.storageByteCost() * storage_used;
  const attached_deposit = near.attachedDeposit();

  assert(
    required_cost <= attached_deposit,
    `Must attach ${required_cost} yoctoNEAR to cover storage`
  );

  const refund = attached_deposit - required_cost;
  if (refund > 1n) {
    const promise_id = near.promiseBatchCreate(account_id);
    near.promiseBatchActionTransfer(promise_id, refund);
    near.promiseReturn(promise_id);
  }
}

function refund_deposit(storage_used: bigint): void {
  refund_deposit_to_account(storage_used, near.predecessorAccountId());
}



class Token{
  token_id: number;
  owner_id: AccountId;
  name: string;
  description: string;
  media_url: string;
  level: number;

  constructor( token_id: number, owner_id: AccountId, name: string, description: string, media_url: string, level: number){
    this.token_id = token_id;
    this.owner_id = owner_id;
    this.name = name;
    this.description = description;
    this.media_url = media_url;
    this.level = level;
  }
}

class NonFungibleToken{
  owner_id: AccountId;
  extra_storage_in_bytes_per_token: bigint;
  owner_by_id: UnorderedMap<AccountId>;
  tokens_per_owner: Option<LookupMap<UnorderedSet<TokenId>>>;
  approvals_by_id: Option<LookupMap<{ [approvals: AccountId ]: bigint }>>;
  next_approval_id_by_id: Option<LookupMap<bigint>>;

  constructor() {
    this.owner_id = "";
    this.extra_storage_in_bytes_per_token = 0n;
    this.owner_by_id = new UnorderedMap("");
    this.tokens_per_owner = null;
    this.approvals_by_id = null;
    this.next_approval_id_by_id = null;
  }

  nft_approve({
    token_id,
    account_id,
    msg,
  }: {
    token_id: TokenId;
    account_id: AccountId;
    msg: string;
  }): Option<NearPromise> {
    assert_at_least_one_yocto();
    if (this.approvals_by_id === null) {
      throw new Error("NFT does not support Approval Management");
    }

    const approvals_by_id = this.approvals_by_id;
    const owner_id = expect_token_found(this.owner_by_id.get(token_id));

    assert(
      near.predecessorAccountId() === owner_id,
      "Predecessor must be token owner."
    );

    const next_approval_id_by_id = expect_approval(this.next_approval_id_by_id);
    const approved_account_ids = approvals_by_id.get(token_id) ?? {};
    const approval_id = next_approval_id_by_id.get(token_id) ?? 1n;
    const old_approved_account_ids_size =
      serialize(approved_account_ids).length;
    approved_account_ids[account_id] = approval_id;
    const new_approved_account_ids_size =
      serialize(approved_account_ids).length;

    approvals_by_id.set(token_id, approved_account_ids);

    next_approval_id_by_id.set(token_id, approval_id + 1n);

    const storage_used =
      new_approved_account_ids_size - old_approved_account_ids_size;
    refund_deposit(BigInt(storage_used));

    if (msg) {
      return NearPromise.new(account_id).functionCallRaw(
        "nft_on_approve",
        serialize({ token_id, owner_id, approval_id, msg }),
        0n,
        near.prepaidGas() - GAS_FOR_NFT_APPROVE
      );
    }
    return null;
  }

  nft_revoke({
    token_id,
    account_id,
  }: {
    token_id: TokenId;
    account_id: AccountId;
  }) {
    assert_one_yocto();
    if (this.approvals_by_id === null) {
      throw new Error("NFT does not support Approval Management");
    }
    const approvals_by_id = this.approvals_by_id;
    const owner_id = expect_token_found(this.owner_by_id.get(token_id));

    const predecessorAccountId = near.predecessorAccountId();
    assert(
      predecessorAccountId === owner_id,
      "Predecessor must be token owner."
    );

    const approved_account_ids = approvals_by_id.get(token_id);
    const old_approved_account_ids_size =
      serialize(approved_account_ids).length;
    let new_approved_account_ids_size;

    if (approved_account_ids[account_id]) {
      delete approved_account_ids[account_id];
      if (Object.keys(approved_account_ids).length === 0) {
        approvals_by_id.remove(token_id);
        new_approved_account_ids_size = serialize(approved_account_ids).length;
      } else {
        approvals_by_id.set(token_id, approved_account_ids);
        new_approved_account_ids_size = 0;
      }
      refund_storage_deposit(
        predecessorAccountId,
        new_approved_account_ids_size - old_approved_account_ids_size
      );
    }
  }

  nft_revoke_all({ token_id }: { token_id: TokenId }) {
    assert_one_yocto();
    if (this.approvals_by_id === null) {
      throw new Error("NFT does not support Approval Management");
    }
    const approvals_by_id = this.approvals_by_id;
    const owner_id = expect_token_found(this.owner_by_id.get(token_id));

    const predecessorAccountId = near.predecessorAccountId();
    assert(
      predecessorAccountId === owner_id,
      "Predecessor must be token owner."
    );

    const approved_account_ids = approvals_by_id.get(token_id);
    if (approved_account_ids) {
      refund_storage_deposit(
        predecessorAccountId,
        serialize(approved_account_ids).length
      );

      approvals_by_id.remove(token_id);
    }
  }

  nft_is_approved({
    token_id,
    approved_account_id,
    approval_id,
  }: {
    token_id: TokenId;
    approved_account_id: AccountId;
    approval_id?: bigint;
  }): boolean {
    expect_token_found(this.owner_by_id.get(token_id));

    if (this.approvals_by_id === null) {
      return false;
    }
    const approvals_by_id = this.approvals_by_id;

    const approved_account_ids = approvals_by_id.get(token_id);
    if (approved_account_ids === null) {
      return false;
    }

    const actual_approval_id = approved_account_ids[approved_account_id];
    if (actual_approval_id === undefined) {
      return false;
    }

    if (approval_id) {
      return BigInt(approval_id) === actual_approval_id;
    }
    return true;
  }
}

@NearBindgen({})
class Contract {
  token_id: number;
  owner_id: AccountId;
  owner_by_id: LookupMap<string>; 
  token_by_id: LookupMap<Token>;

  constructor(){
    this.token_id = 0;
    this.owner_id = "";
    this.owner_by_id = new LookupMap("o");
    this.token_by_id = new LookupMap("t");
  }

  @initialize({})
  init({ owner_id, prefix } : { owner_id: AccountId; prefix: string }){
    this.owner_id = owner_id;
    this.token_id = 0;
    this.owner_by_id = new LookupMap(prefix);
    this.token_by_id = new LookupMap("t");
  }

  @call({})
  mint_nft({ token_owner_id, name, description, media_url, level }: { token_owner_id: string, name: string, description: string, media_url: string, level: number }){
    this.owner_by_id.set(this.token_id.toString(),token_owner_id);
    let token = new Token(this.token_id, token_owner_id, name, description, media_url, level);
    this.token_by_id.set(this.token_id.toString(), token);
    this.token_id++;
    return token;
  }

  @view({})
  get_token_by_id({ token_id }: { token_id: number }){
    let token = this.token_by_id.get(token_id.toString());
    if(token==null){
      return null;
    }
    return token;
  }

  @view({})
  get_supply_tokens(){
    return this.token_id;
  }

  @view({})
  get_all_tokens({start,max}: {start?: number, max?: number}){
    var all_tokens = [];
    for (var i = 0; i < this.token_id; i++){
      all_tokens.push(this.token_by_id.get(i.toString()));
    }

    return all_tokens;
  }

  

}