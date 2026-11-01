// Evaluated text gets every exports object of this program, so nothing about them is proven for good. While a body has run nobody else's code, its exports object is still as the body made it:
// the stores in front of the first call go into the slots without a test, several in one step. What stands behind a call that froze the object, put it below another prototype or made a
// field an accessor does what plain Bun does.
// STATISTIC: SlotStoreRunGroups >= 4
const evaluate = (0, eval)(process.argv[9] || "(text) => (0, eval)(text)");
globalThis.freeze = evaluate("(object) => Object.freeze(object)");
globalThis.seal = evaluate("(object) => Object.preventExtensions(object)");
globalThis.putBelowSetter = evaluate("(object) => Object.setPrototypeOf(object, { set late(value) { console.log('setter above got', value); } })");
globalThis.makeAccessor = evaluate("(object) => Object.defineProperty(object, 'late', { get() { return 'from the getter'; }, set(value) { console.log('own setter got', value); }, enumerable: true, configurable: true })");
globalThis.remove = evaluate("(object) => delete object.early");
globalThis.look = evaluate("(object) => JSON.stringify(Object.getOwnPropertyDescriptors(object))");

for (const name of ["./made.cjs", "./frozen.cjs", "./closed.cjs", "./below-a-setter.cjs", "./accessor.cjs", "./deleted.cjs", "./defined.cjs", "./first.cjs"]) {
  const exported = require(name);
  console.log(name, Object.keys(exported).join(), look(exported), Object.isFrozen(exported), Object.isExtensible(exported));
}
console.log(require("./made.cjs").__esModule, require("./made.cjs").NAME_7);
