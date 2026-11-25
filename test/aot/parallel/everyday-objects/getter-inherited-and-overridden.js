// A getter of a base class, overridden and reached by super
class Account {
  constructor(sum) {
    this.sum = sum;
  }
  get balance() {
    return this.sum;
  }
  get label() {
    return this.constructor.name + ":" + this.balance;
  }
}
class Credit extends Account {
  get balance() {
    return super.balance - 100;
  }
}
function show(sum) {
  return [new Account(sum), new Credit(sum)].map(account => account.label).join(" ");
}
console.log(show(5));
console.log(show(100));
console.log(show(-1));
