// Receivers below an accessor: Object.getOwnPropertyDescriptor hands the getter and the setter of a class back as plain functions, and the program calls them on a string, on nothing and on another class.
let total = 0;

class Account {
  balance = 10;
  get doubled(): number {
    total += this === undefined ? 100 : this instanceof Account ? 1 : 10000;
    return this === undefined ? -1 : this.balance * 2;
  }
  set doubled(value: number) {
    total += typeof value === "number" ? 1000000 : 100000000;
    this.balance = value / 2;
  }
}

class Wallet {
  balance = "30";
}

const account = new Account();
account.doubled = account.doubled + 2;
const { get, set } = Object.getOwnPropertyDescriptor(Account.prototype, "doubled")!;
const wallet = new Wallet();
set!.call(wallet, "50");
const all = Object.getOwnPropertyDescriptors(Account.prototype);
const results: unknown[] = [account.balance, get!.call(account), get!.call("text"), get!.call(undefined), get!.call(new Wallet()), wallet.balance, all.doubled.get!.call({ balance: [4] }), (account as any).__lookupGetter__("doubled") === get];
console.log(total, results.join());
