// One file holds two copies of a small library, each in a scope of its own: their methods bear the same names, are handed instances of their own constructor functions, and other values too.
"use strict";
const old = (function () {
  function Amount(units, tag) {
    this.units = units;
    this.tag = tag;
  }
  function Basket() {
    this.held = [];
    this.last = null;
  }
  Amount.prototype.plus = function (other) {
    return new Amount(this.units + other.units, this.tag);
  };
  Amount.prototype.over = function (other) {
    return this.units > other.units;
  };
  Basket.prototype.put = function (amount) {
    this.held.push(amount);
    this.last = amount;
    return this;
  };
  Basket.prototype.sum = function () {
    let all = new Amount(0, "old");
    for (let at = 0; at < this.held.length; at++) all = all.plus(this.held[at]);
    return all;
  };
  Basket.prototype.most = function () {
    let found = this.held[0];
    for (let at = 1; at < this.held.length; at++) if (this.held[at].over(found)) found = this.held[at];
    return found;
  };
  return { Amount, Basket };
})();
const fresh = (function () {
  function Amount(units, rate) {
    this.rate = rate;
    this.parts = [units];
    this.units = units;
  }
  function Basket(name) {
    this.name = name;
    this.held = [];
    this.last = null;
    this.count = 0;
  }
  Amount.prototype.plus = function (other) {
    const made = new Amount(this.units + other.units * other.rate, this.rate);
    made.parts = this.parts.concat(other.parts);
    return made;
  };
  Amount.prototype.over = function (other) {
    return this.units * this.rate > other.units * other.rate;
  };
  Basket.prototype.put = function (amount) {
    this.count++;
    this.held.push(amount);
    this.last = amount;
    return this;
  };
  Basket.prototype.sum = function () {
    let all = new Amount(0, 1);
    for (let at = 0; at < this.held.length; at++) all = all.plus(this.held[at]);
    return all;
  };
  Basket.prototype.most = function () {
    let found = this.held[0];
    for (let at = 1; at < this.held.length; at++) if (this.held[at].over(found)) found = this.held[at];
    return found;
  };
  return { Amount, Basket };
})();
function run(library, second, turns) {
  const basket = new library.Basket("b");
  for (let turn = 0; turn < turns; turn++) basket.put(new library.Amount((turn * 7) % 13, second));
  return basket;
}
let sum = 0;
for (let turn = 0; turn < 80; turn++) {
  const a = run(old, "t", 12), b = run(fresh, 2, 9);
  sum += a.sum().units + b.sum().units + a.most().units + b.most().parts.length + (a.last.over(a.held[0]) ? 1 : 0) + (b.last.over(b.held[1]) ? 2 : 0);
}
console.log(sum);
// Instances of the one go to methods of the other, and so do literals and values that are no objects.
const mixed = new old.Basket().put(new fresh.Amount(4, 3)).put(new old.Amount(9, "x")).put({ units: 2, over: () => true });
console.log(mixed.sum().units, mixed.last.units, mixed.held.length);
try { console.log(mixed.most().units); } catch (error) { console.log(error.constructor.name); }
console.log(new old.Amount(1, "a").plus({ units: "2" }).units, new fresh.Amount(1, 2).plus(new old.Amount(5, "y")).units, new old.Amount(3).over(7), new fresh.Amount(3, 1).over("text"));
for (const none of [null, undefined]) {
  try { new old.Amount(1).plus(none); } catch (error) { console.log(error.constructor.name); }
}
console.log(fresh.Basket.prototype.sum.call({ held: [new fresh.Amount(2, 5), new fresh.Amount(1, 1)] }).parts.join(), new fresh.Basket("n").most());
