// calls a method that stays a call
class Account {
  constructor(
    public id: number,
    public balance: number,
  ) {}
  after(deposit: number): number {
    if (deposit < 0) return process.argv.length;
    return this.balance + deposit;
  }
}
const operations = 100;
const accounts: Account[] = [];
for (let i = 0; i < operations; i++) accounts.push(new Account(i, i * 2));
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < accounts.length; i++) sum += accounts[i].after(i);
  total += sum;
}

console.log(total);
