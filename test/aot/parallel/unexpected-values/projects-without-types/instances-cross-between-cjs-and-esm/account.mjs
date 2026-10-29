export class Account {
  #balance = 0;
  owner;
  constructor(owner, balance) {
    this.owner = owner;
    this.#balance = balance;
  }
  get balance() {
    return this.#balance;
  }
  deposit(amount) {
    this.#balance += amount;
    return this.#balance;
  }
  static isAccount(value) {
    return #balance in value;
  }
  static balanceOf(value) {
    return value.#balance;
  }
}
export function richest(accounts) {
  let best = accounts[0];
  for (const account of accounts) if (account.balance > best.balance) best = account;
  return best.owner;
}
