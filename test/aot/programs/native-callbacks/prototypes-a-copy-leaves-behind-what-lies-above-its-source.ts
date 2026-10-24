// A spread and Object.assign take own enumerable properties. Methods of the class, getters of its prototype object and what Object.prototype holds stay behind.
class Account {
  balance = 10;
  get doubled(): number {
    return this.balance * 2;
  }
  deposit(amount: number): number {
    return (this.balance += amount);
  }
}

const account = new Account();
Object.defineProperty(account, "own", { get() { return this.balance + 1; }, enumerable: true });
const bare: any = { __proto__: null, ...account };
console.log(bare.balance, bare.own, bare.doubled, typeof bare.deposit, typeof bare.toString, typeof bare.constructor);
account.deposit(5);
console.log(bare.balance, bare.own, Object.getPrototypeOf(bare), bare.__proto__);

const assigned: any = Object.assign(Object.create(null), account);
console.log(assigned.balance, assigned.own, assigned.doubled, typeof assigned.deposit, typeof assigned.valueOf);

const ordinary: any = { ...account };
console.log(ordinary.balance, typeof ordinary.deposit, typeof ordinary.toString, ordinary.constructor === Object, Account.prototype.isPrototypeOf(ordinary), Object.prototype.isPrototypeOf.call(account, ordinary));

const heir: any = { __proto__: account, top: 1 };
const twice: any = { __proto__: null, ...heir };
console.log(twice.top, twice.balance, typeof twice.deposit);

let names = "";
for (const name in bare) names += name + " ";
for (const name in { __proto__: account, top: 1 }) names += name + " ";
console.log(names);
