// Private fields, methods, statics and `#name in object`.
class Account {
  #balance: number;
  static #created = 0;
  constructor(balance: number) {
    this.#balance = balance;
    Account.#created++;
  }
  #check(amount: number): boolean {
    return amount <= this.#balance;
  }
  get #doubled(): number {
    return this.#balance * 2;
  }
  withdraw(amount: number): boolean {
    if (!this.#check(amount)) return false;
    this.#balance -= amount;
    return true;
  }
  static isAccount(value: object): boolean {
    return #balance in value;
  }
  static get created(): number {
    return Account.#created;
  }
  summary(): string {
    return `${this.#balance}/${this.#doubled}`;
  }
}
const account = new Account(10);
console.log(account.withdraw(3), account.withdraw(30), account.summary());
console.log(Account.isAccount(account), Account.isAccount({}), Account.created);
try {
  Account.prototype.withdraw.call({} as Account, 1);
} catch (error) {
  console.log((error as Error).name);
}
