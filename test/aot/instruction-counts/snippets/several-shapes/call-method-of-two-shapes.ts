// calls an inherited method of objects of two shapes in turn
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
class Account1 extends Account {
  extra1 = 1;
}
const operations = 96;
const classes = [Account, Account1];
const accounts: Account[] = [];
for (let i = 0; i < operations; i++) accounts.push(new classes[i % classes.length](i, i * 2));
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < accounts.length; i++) sum += accounts[i].after(i);
  total += sum;
}

console.log(total);
