// util._extend() stores under the keys of its second argument into its first. It is handed two values that the compiler cannot follow, and then String.prototype, which comes through ten calls; members that can be replaced are written that way and then called on a string. ../../flow-schedules-beside-a-hidden-value.test.ts builds it under four schedules.
// Alone: what it prints depends on what else the executable holds: another program that writes to String.prototype unlocks the same members
import util from "node:util";
const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(util._extend(hide({ a: 1 }), hide({ b: 2 })));
const l0 = { get: () => String.prototype };
const l1 = { get: () => l0.get() };
const l2 = { get: () => l1.get() };
const l3 = { get: () => l2.get() };
const l4 = { get: () => l3.get() };
const l5 = { get: () => l4.get() };
const l6 = { get: () => l5.get() };
const l7 = { get: () => l6.get() };
const l8 = { get: () => l7.get() };
const l9 = { get: () => l8.get() };
try {
  hide(
    util._extend(l9.get(), {
      trim() {
        return "trim of " + this;
      },
      at(index) {
        return "at " + index + " of " + this;
      },
      shout() {
        return this.toUpperCase() + "!";
      },
    }),
  );
  console.log("extended");
} catch (error) {
  console.log(error.name);
}
console.log(" x ".trim(), "|", "x".at(0), "|", "x".shout(), "|", " x ".trimEnd() + ".");
