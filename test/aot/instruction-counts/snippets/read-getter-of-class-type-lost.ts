// reads a getter of a class from objects whose type is lost
const operations = 100;
class Account {
  cents: number;
  constructor(cents: number) {
    this.cents = cents;
  }
  get balance(): number {
    return this.cents + 1;
  }
}
function open(cents: number): any {
  return new Account(cents);
}
const accounts = [open(1), open(2), open(3), open(4)];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += accounts[i & 3].balance;
  total += sum;
}

console.log(total);
