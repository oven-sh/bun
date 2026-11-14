class Account {
  balance = 0;
  constructor(public owner: string) {}
  add(n: number) {
    this.balance += n;
    return this.balance;
  }
}
const accounts = [new Account("a"), new Account("b")];
function pay(list: Account[], n: number): string {
  let text = "";
  for (const account of list) {
    try {
      text += account.add(n) + " ";
    } catch (e) {
      text += (e as Error).constructor.name + " ";
    }
  }
  return text;
}
console.log(pay(accounts, 5));
Object.freeze(accounts[1]);
console.log(pay(accounts, 7), accounts[1].balance, Object.isFrozen(accounts[1]));
