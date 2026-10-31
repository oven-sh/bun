// globalThis.WeakMap is undefined while node:test loads: its body has defined its classes when a module that it asks for throws.
// The next require runs the body again, which defines the classes a second time, and the one behind it, with WeakMap back, gets the module.
const RealWeakMap = globalThis.WeakMap;
globalThis.WeakMap = undefined;
const thrown = [];
for (const round of [1, 2]) {
  try {
    console.log(round, typeof require("node:test").test);
  } catch (error) {
    thrown.push(error);
    console.log(round, error.name);
  }
}
globalThis.WeakMap = RealWeakMap;
// A body that does not throw leaves nothing to ask.
if (thrown.length !== 2) throw new Error("node:test loads without WeakMap");
const test = require("node:test");
const counted = test.mock.fn(() => 1);
counted();
counted();
console.log(3, typeof test.test, typeof test.describe, counted.mock.callCount());
console.log(4, thrown[0] === thrown[1], require("node:test") === test);
