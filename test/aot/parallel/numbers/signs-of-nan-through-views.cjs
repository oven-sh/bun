"use strict";
class Vector {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
const numbers = new Float64Array(4);
const bits = new BigUint64Array(numbers.buffer);
function difference(a, b) {
  numbers[0] = a.x * 1e308 * 10 - b.x * 1e308 * 10;
  return bits[0].toString(16);
}
function quotient(a, b) {
  const product = a.y * 0;
  numbers[1] = product / (b.y * 0);
  return bits[1].toString(16);
}
function held(a, b) {
  const list = [a.x * 1e308 * 10 - b.x * 1e308 * 10];
  numbers[2] = list[0];
  numbers[3] = -(a.x - b.x * 1);
  return bits[2].toString(16) + "/" + (a.x === b.x ? "" : bits[3].toString(16));
}
const made = [new Vector(1, 2), new Vector(3, 4), new Vector(undefined, 1), new Vector(2)];
for (let turn = 0; turn < 3; turn++) console.log(difference(made[0], made[1]), quotient(made[0], made[1]), held(made[0], made[1]), String(numbers));
console.log(difference(made[2], made[0]), quotient(made[2], made[3]), String(numbers));
