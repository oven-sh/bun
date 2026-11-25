// total = (total + number) | 0 in a loop, where the total is a variable of the module, a captured variable or a field. A number that is an int32 is added as an integer.
// STATISTIC: DoublesRecomputedAsIntegers >= 60
"use strict";
let total = 0, difference = 1, hash = 7, kept = 3, sum = 11;
function add(...values) { for (const value of values) total = (total + (typeof value === "string" ? value.length : typeof value === "number" ? value : 1)) | 0; return total; }
function subtract(list, other) { for (let k = 0; k < list.length; k++) { const value = list[k]; difference = (difference - (typeof value === "number" ? value : other)) | 0; } return difference; }
function mix(list) { for (const value of list) hash = (value.weight + hash) | 0; return hash; }
function twice(list) { for (const value of list) { kept = (kept + value) | 0; kept = (kept + value) | 0; } return kept; }
class Counter {
  total = 0;
  add(list) { for (const value of list) this.total = (this.total + value) | 0; return this.total; }
  subtract(list) { for (let k = 0; k < list.length; k++) this.total = (this.total - list[k]) | 0; return this.total; }
}
function make() {
  let inner = 0;
  return { add(list) { for (let k = 0; k < list.length; k++) inner = (inner + list[k]) | 0; return inner; } };
}
function addNumbers(list) { for (const value of list) sum = (sum + value) | 0; return sum; }
const edges = [0, -0, 1, -1, 0.5, -0.5, 1.5, NaN, Infinity, -Infinity, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 4294967296, 2 ** 52, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 2 ** 60, 2 ** 63, 2 ** 64, 1e21, 1e300, 5e-324, 1073741824.75];
const numbers = edges.map((value) => value), small = edges.map((value, k) => (k % 5 === 3 ? k + 0.25 : k * 1000003));
const counter = new Counter(), inner = make();
for (let round = 0; round < 30; round++) {
  console.log(round, add(round, "ab", null, undefined), add(...edges), add(round / 3, "", {}), subtract(edges, round), subtract([round, "s", round * 1e6], 0.5), mix(edges.map((weight) => ({ weight }))), mix([{ weight: round }, { weight: "w" }]), mix([{ weight: 5 }]));
  hash = round; total = 2147483647 - round; difference = -2147483648 + round; counter.total = 2147483647 - round;
  console.log(add(round, round + 1, 2147483647), subtract([round, 1, 2147483647, -2147483648], 1), twice(edges), twice([round, 1e9]));
  console.log(counter.add(numbers), counter.add(small), counter.subtract(numbers), counter.subtract(small), inner.add(numbers), inner.add(small), addNumbers(numbers), addNumbers(small));
}
