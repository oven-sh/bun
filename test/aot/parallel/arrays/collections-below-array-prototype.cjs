// COUNT: operation:operationAOTPutById <= 120
// Objects below Array.prototype that count their elements: length, an object and elements are stored in every construction.
"use strict";
function Herd(field, beasts) {
  this.length = 0;
  for (const beast of beasts) if (beast !== null && beast !== undefined) this[this.length++] = beast;
  this.kept = { field, herd: this };
}
const ways = Herd.prototype = Object.create(Array.prototype);
ways.said = function () { return "a herd"; };
ways.leader = function () { return this[0]; };
ways.driven = function (beasts) { return new Herd(this.kept.field, beasts); };
ways.sum = function () { let sum = 0; for (let at = 0; at < this.length; at++) sum += this[at]; return sum; };
function Beast(field, weight) {
  this.length = 1;
  this[0] = this;
  this.weight = weight;
}
Beast.prototype = Object.create(Herd.prototype);
const lists = [[1, 2, 3], [], [4, null, 5], [undefined], [6, 7, 8, 9, 10, 11, 12]];
let total = 0, text = "";
for (let round = 0; round < 400; round++) {
  const made = new Herd(round, lists[round % lists.length]);
  const other = made.driven([round, made.length]);
  const element = new Beast(round, other.sum());
  total = (total + made.sum() * 3 + other.length + element.length + element[0].weight + made.kept.field + made.map(value => value + 1).length) % 1000003;
  if (round > 396) text += JSON.stringify(Object.getOwnPropertyDescriptor(made, "length")) + Object.keys(made).join() + Object.keys(element).join() + (made instanceof Array) + made.join("-") + " ";
}
console.log(total, text);
class Indexed { get 1() { return "getter"; } 2() { return "method"; } }
function Instance() { this[0] = "a"; try { this[1] = "b"; } catch (error) { this.error = error.constructor.name; } this[2] = "c"; }
const results = [];
for (let round = 0; round < 60; round++) {
  const plain = new Indexed();
  const before = plain[1] + typeof plain[2];
  plain[0] = round;
  plain[2] = "own";
  results.push(before + plain[1] + plain[2] + plain[0]);
}
console.log(results[0], results[59], new Set(results).size, JSON.stringify(new Instance()));
