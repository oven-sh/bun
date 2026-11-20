// COUNT: operation:operationAOTPutById <= 120
// Objects below Array.prototype that count their elements: length, an object and elements are stored in every construction.
"use strict";
function Collection(core, elements) {
  this.length = 0;
  for (let index = 0; index < elements.length; index++) {
    if (elements[index] == null) continue;
    this[this.length] = elements[index];
    this.length++;
  }
  this._private = { core, owner: this };
}
const methods = Collection.prototype = Object.create(Array.prototype);
methods.instanceString = function () { return "collection"; };
methods.first = function () { return this[0]; };
methods.spawn = function (elements) { return new Collection(this._private.core, elements); };
methods.sum = function () { let sum = 0; for (let index = 0; index < this.length; index++) sum += this[index]; return sum; };
function Element(core, value) {
  this.length = 1;
  this[0] = this;
  this.value = value;
}
Element.prototype = Object.create(Collection.prototype);
const lists = [[1, 2, 3], [], [4, null, 5], [undefined], [6, 7, 8, 9, 10, 11, 12]];
let total = 0, text = "";
for (let round = 0; round < 400; round++) {
  const made = new Collection(round, lists[round % lists.length]);
  const other = made.spawn([round, made.length]);
  const element = new Element(round, other.sum());
  total = (total + made.sum() * 3 + other.length + element.length + element[0].value + made._private.core + made.map(value => value + 1).length) % 1000003;
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
