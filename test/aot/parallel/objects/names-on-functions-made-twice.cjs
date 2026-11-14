"use strict";
function make(limit) {
  function Counter(x) {
    this.x = x;
  }
  Counter.prototype.next = function () {
    return this.x < Counter.limit ? ++this.x : Counter.made;
  };
  Counter.limit = limit;
  Counter.made = 0;
  return Counter;
}
const Small = make(2), Large = make(5);
Small.made = -1;
for (const Counter of [Small, Large]) {
  const counter = new Counter(0);
  let line = "";
  for (let k = 0; k < 7; k++) line += " " + counter.next();
  console.log(line, Counter.limit, Counter.made);
}
function Once(x) {
  this.x = x;
}
Once.prototype.scaled = function () {
  return this.x * (Once.scale ?? 1);
};
const once = new Once(3);
const scales = [];
for (let k = 0; k < 3; k++) scales.push(once.scaled());
Once.scale = 2;
for (let k = 0; k < 3; k++) scales.push(once.scaled());
Object.defineProperty(Once, "fixed", { value: 4, writable: false, configurable: true });
try {
  Once.fixed = 5;
} catch (error) {
  scales.push(error.constructor.name);
}
scales.push(Once.fixed);
delete Once.scale;
for (let k = 0; k < 2; k++) scales.push(once.scaled());
console.log(scales.join());
