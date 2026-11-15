// Private fields and methods, a private static counter and a brand test
class Wallet {
  static #count = 0;
  #coins = [];
  constructor(...coins) {
    Wallet.#count++;
    this.#coins.push(...coins);
  }
  get #sum() {
    return this.#coins.reduce((a, b) => a + b, 0);
  }
  #take() {
    return this.#coins.pop();
  }
  pay(price) {
    let paid = 0;
    while (paid < price && this.#coins.length) paid += this.#take();
    return paid + "/" + this.#sum;
  }
  static is(value) {
    return #coins in value;
  }
  static get count() {
    return Wallet.#count;
  }
}
console.log(new Wallet(1, 2, 5).pay(6), Wallet.count);
console.log(new Wallet(10, 20).pay(5), Wallet.is({}), Wallet.count);
console.log(new Wallet().pay(1), Wallet.is(new Wallet(3)), Wallet.count);
