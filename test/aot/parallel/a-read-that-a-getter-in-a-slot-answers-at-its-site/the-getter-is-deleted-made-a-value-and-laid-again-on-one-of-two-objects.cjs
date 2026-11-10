"use strict";
function make(step) {
  const made = Object.create({ rate: -1 });
  Object.defineProperty(made, "rate", { enumerable: true, configurable: true, get: function () { return step; } });
  return made;
}
const one = make(3), other = make(5);
globalThis.kept = [one, other];
function total(turns) {
  let sum = 0, there = 0, own = 0;
  const list = globalThis.kept;
  for (let turn = 0; turn < turns; turn++) {
    const held = list[turn & 1];
    sum = (sum + held.rate) | 0;
    if ("rate" in held) there++;
    if (Object.prototype.hasOwnProperty.call(held, "rate")) own++;
    if (Object.hasOwn(held, "rate")) own++;
  }
  return sum + " " + there + " " + own;
}
const deeds = [
  () => {},
  () => { delete one.rate; },
  () => { Object.defineProperty(one, "rate", { enumerable: true, configurable: true, get: function () { return 7; } }); },
  () => { Object.defineProperty(one, "rate", { enumerable: true, configurable: true, writable: true, value: 11 }); },
  () => { one.rate = 13; },
  () => { Object.defineProperty(one, "rate", { configurable: true, get: undefined, set: function () {} }); },
  () => { delete one.rate; Object.setPrototypeOf(one, null); },
  () => { Object.defineProperty(one, "rate", { enumerable: true, configurable: true, get: function () { return this === one ? 17 : 19; } }); },
];
for (const deed of deeds) { deed(); console.log(total(5200)); }
