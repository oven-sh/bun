// Fields that a method compares and another steps, where other code stores values of any kind into them.
"use strict";
class Counter {
  constructor(value) { this.value = value; }
  isPast(n) { return this.value > n; }
  step() { this.value++; return this.value; }
  back() { --this.value; return this.value; }
}
const key = process.argv.length > 99 ? "other" : "value";
const show = value => Object.is(value, -0) ? "-0" : typeof value + ":" + String(value);
const values = [0, -0, 0.5, -1, NaN, Infinity, -Infinity, "7", "x", null, undefined, true, 3n, { valueOf() { return 41; } }, [5], 9007199254740992, 1e300, 2 ** 31 - 1];
for (const value of values) {
  const counter = new Counter(0), seen = [];
  for (let turn = 0; turn < 3; turn++) {
    if (turn === 1) counter[key] = value;
    try { seen.push(show(counter.step())); } catch (error) { seen.push(error.constructor.name); }
    try { seen.push(show(counter.back()), counter.isPast(1)); } catch (error) { seen.push(error.constructor.name); }
  }
  console.log(seen.join(" "));
}
const frozen = Object.freeze(new Counter(5));
try { frozen.step(); } catch (error) { console.log(error.constructor.name, frozen.value); }
class Heir extends Counter { get twice() { return this.value * 2; } step() { super.step(); return super.step(); } }
const heirs = [new Heir(1), new Counter(2), Object.assign(new Heir(3), { value: 2.5 }), Object.create(new Counter(4))];
for (let k = 0; k < 50; k++) for (const heir of heirs) { heir.step(); if (heir.isPast(60)) heir.back(); }
console.log(heirs.map(heir => show(heir.value)).join(), heirs[0].twice);
