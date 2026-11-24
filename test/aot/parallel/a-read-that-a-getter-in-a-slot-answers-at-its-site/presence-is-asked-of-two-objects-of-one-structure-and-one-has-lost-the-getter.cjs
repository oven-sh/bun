"use strict";
const above = {};
function make(step) {
  const made = Object.create(above);
  Object.defineProperty(made, "rate", { enumerable: true, configurable: true, get: function () { return step; } });
  return made;
}
const one = make(3), other = make(5);
globalThis.kept = [one, other];
function ask(turns) {
  const list = globalThis.kept;
  let there = 0, own = 0, has = 0, sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const held = list[turn & 1];
    if ("rate" in held) there++;
    if (Object.prototype.hasOwnProperty.call(held, "rate")) own++;
    if (Object.hasOwn(held, "rate")) has++;
    if (held.hasOwnProperty("rate")) has++;
    const found = held.rate;
    sum = (sum + (found === undefined ? 100 : found)) | 0;
  }
  return there + " " + own + " " + has + " " + sum;
}
console.log(ask(5200));
delete one.rate;
console.log(ask(5200));
Object.defineProperty(one, "rate", { enumerable: true, configurable: true, writable: true, value: 11 });
console.log(ask(5200));
delete one.rate;
above.rate = 13;
console.log(ask(5200));
