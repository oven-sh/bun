"use strict";
function Tally() { this.sum = 0; this.steps = 0; }
Tally.prototype = {
  raise: function (v) { this.sum = this.sum + v; this.steps = this.steps + 1; return this; },
  lower: function () { this.steps = this.steps - 1; return this.sum; },
  get paces() { return this.steps; },
};
function total(count, change) {
  let all = 0;
  const t = new Tally();
  for (let i = 0; i < count; i++) {
    if (i === 5) change(t, Tally);
    t.raise(i).raise(1);
    all += t.paces;
    all += t.lower() + t.lower();
  }
  return all;
}
function fresh(count) {
  let all = 0;
  for (let i = 0; i < count; i++) {
    const t = new Tally();
    t.raise(i);
    all += t.paces + t.lower();
  }
  return all;
}
const change = (0, eval)('(t => { Object.defineProperty(Object.getPrototypeOf(t), "paces", { get() { return 50; } }); })');
try {
  console.log(total(10, change), fresh(10), total(10, () => {}));
} catch (error) {
  console.log(error.name);
}
