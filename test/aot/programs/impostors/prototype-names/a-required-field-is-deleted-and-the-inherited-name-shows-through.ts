// The constructor always fills these fields, so a read needs no test at all, until `delete` empties the slot of one instance.
// By then the prototype has a member of that name: a value for one field, a getter and a setter for the other. It must show through, for that instance only.
const log: string[] = [];
class Account {
  balance: number;
  owner: string;
  constructor(balance: number, owner: string) {
    this.balance = balance;
    this.owner = owner;
  }
}
function balanceOf(account: Account) {
  return account.balance;
}
function ownerOf(account: Account) {
  return account.owner;
}
function deposit(account: Account, amount: number) {
  account.balance += amount;
}
function rename(account: Account, owner: string) {
  account.owner = owner;
}
function state(account: Account) {
  return `${balanceOf(account)} ${ownerOf(account)} [${Object.keys(account)}]`;
}
function total(accounts: Account[]) {
  let sum = 0;
  for (const account of accounts) sum += account.balance + account.owner.length;
  return sum;
}

const accounts: Account[] = [];
for (let i = 0; i < 3000; i++) accounts.push(new Account(i & 15, "o" + (i & 1)));
console.log("warm", total(accounts));

const holder: any = Object.getPrototypeOf(accounts[0]);
holder["balance"] = 1_000_000;
Object.defineProperty(holder, "owner", {
  get() {
    return "nobody at all";
  },
  set(this: Account, value: string) {
    log.push("owner = " + value);
  },
  configurable: true,
});
console.log("hidden by the own fields:", total(accounts), state(accounts[7]), state(new Account(1, "n")), log.length);
delete (accounts[7] as any).balance;
delete (accounts[8] as any).owner;
console.log("deleted:", state(accounts[7]), "|", state(accounts[8]), "|", state(accounts[9]), "|", total(accounts));
deposit(accounts[7], 5);
rename(accounts[8], "someone");
deposit(accounts[9], 5);
rename(accounts[9], "someone");
console.log("stored:", state(accounts[7]), "|", state(accounts[8]), "|", state(accounts[9]), "|", log.join(", "));
delete holder.balance;
delete holder.owner;
delete (accounts[7] as any).balance;
console.log("nothing to inherit:", state(accounts[7]), "|", state(accounts[8]));
rename(accounts[8], "back");
accounts[7].balance = 3;
console.log("filled again:", state(accounts[7]), "|", state(accounts[8]), "|", total(accounts));
