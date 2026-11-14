// The number that a loop pops is unboxed where the list was asked for its kind, and not behind the join with the rare way.
// STATISTIC: JoinsCarriedUnboxed >= 5
"use strict";
class Purse {
  #coins = [];
  add(coin) { this.#coins.push(coin & 1023); return this; }
  take() { return this.#coins.pop(); }
  sum(count) {
    let total = 0;
    for (let k = 0; k < count; k++) total += this.#coins.pop() + this.#coins.pop();
    return total;
  }
  pay(price) {
    let paid = 0;
    while (paid < price && this.#coins.length) paid += this.take();
    return paid + "/" + this.#coins.length;
  }
  get size() { return this.#coins.length; }
}
class Mixed {
  #list;
  constructor(list) { this.#list = list; }
  sum(count) {
    let total = 0;
    for (let k = 0; k < count; k++) total += this.#list.pop();
    return total;
  }
}
for (let round = 0; round < 40; round++) {
  const purse = new Purse();
  for (let k = 0; k < round; k++) purse.add(k * 37);
  console.log(round, purse.pay(round * 50), purse.sum(round >> 2), purse.size, purse.sum(round & 3), new Purse().sum(1), new Purse().add(5).sum(1));
}
const lists = [[1, 2, 3], [1.5, 2, 3], [1, , 3], ["1", 2], [undefined, 1], [null, 4], [true, 2], [], Object.freeze([]), [2147483647, 2147483647], [-0], [{ valueOf() { return 7; } }, 1], Array.from({ length: 5 }, (_, k) => k), [1n]];
for (const list of lists) for (let count = 0; count < 4; count++) {
  try { console.log(count, new Mixed(list.slice()).sum(count), Object.is(new Mixed(list.slice()).sum(count), -0)); } catch (error) { console.log(error.constructor.name); }
}
