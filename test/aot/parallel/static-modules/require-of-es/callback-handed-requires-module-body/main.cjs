// A callback handed over requires the module while its body runs.
const registry = require("./registry.cjs");
function late() {
  const all = require("./values.mjs");
  return [typeof all, Object.keys(all).join(), typeof all.one, typeof all.bump].join(" ");
}
// No request leads from values.mjs back to this file: the function gets there through the list. `bun run` answers an object without keys here, because a `require` began the
// evaluation; had an import begun it, it would answer the namespace object with its bindings as they are. A compiled executable always does the second.
registry.listeners.push(() => {
  try {
    console.log("while it runs:", late());
  } catch (error) {
    console.log("while it runs: threw", error.name);
  }
});
console.log("first:", late());
console.log("again:", late());
/* Output:
while it runs: threw ReferenceError
first: object bump,one number function
again: object bump,one number function
*/
