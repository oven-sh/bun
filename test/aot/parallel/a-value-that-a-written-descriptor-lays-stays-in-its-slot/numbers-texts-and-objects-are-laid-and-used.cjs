"use strict";
function make(turn) {
  const made = {};
  Object.defineProperty(made, "count", { value: turn & 7 });
  Object.defineProperty(made, "ratio", { value: turn / 4, enumerable: true });
  Object.defineProperty(made, "label", { value: "n" + (turn & 3), writable: true });
  Object.defineProperty(made, "inner", { value: { depth: turn & 1 }, configurable: true });
  return made;
}
function use(made) { return made.count * 2 + made.ratio + made.label.length + made.inner.depth; }
let said = 0; for (let turn = 0; turn < 2000; turn++) said += use(make(turn));
const last = make(5); last.label = "longer";
console.log(said, use(last), Object.keys(last).join(), JSON.stringify(last));
