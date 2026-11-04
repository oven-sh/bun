// One function is called right, wrong and right again: the next call is tested anew, and nothing of a failed guard is left behind.
class Account {
  balance = 0;
  owner = "nobody";
  constructor(balance: number, owner: string) {
    this.balance = balance;
    this.owner = owner;
  }
}
function describe(account: Account, factor: number): string {
  const balance = account.balance;
  const owner = account.owner;
  const scaled = balance * factor;
  return owner + " has " + scaled + " (" + typeof balance + ", " + typeof factor + ")";
}
const parsed: any = JSON.parse('{"balance":"12","owner":"parsed"}');
const text: any = "3";
const rows: [any, any][] = [[new Account(1, "a"), 2], [parsed, 2], [new Account(2, "b"), 3], [new Account(3, "c"), text], [new Account(4, "d"), 4], [parsed, text], [new Account(5, "e"), 5], [{ balance: 6, owner: "literal" }, 6], [new Account(7, "f"), 7]];
for (let turn = 0; turn < 3; turn++) {
  for (const [account, factor] of rows) console.log(turn, describe(account, factor));
}
let total = 0;
function add(n: number): number {
  const before = total;
  total = before + n;
  return total * 2 - before;
}
const mixed: any[] = [1, 2, "3", 4, null, 5, undefined, 6, 7.5, "x", 8];
for (const value of mixed) console.log(String(add(value)), typeof total);
