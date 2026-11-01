// None of these reads a member of Object, String.prototype or Promise: a literal without a prototype, an import() and a require() of a name made at run time.
// Number.isSafeInteger is read in front of its operand, whatever the operand is.
// Alone: the order of the keys of a built-in object follows from which members were read first, and the other entry points of a joined executable read some
function list(holder) {
  Object.entries(holder);
  console.log(Reflect.ownKeys(holder).map(String).join());
}
const bare = { __proto__: null };
console.log(typeof bare);
list(Object);
const name = ["node:", "path"].join(Date.now() < 5 ? "x" : "");
const loaded = await import(name);
const missing = await import(name + "/nowhere").catch(error => typeof error);
if (Number.isSafeInteger("no number")) console.log("never");
console.log(typeof loaded.join, missing, typeof require(name).join);
for (const holder of [String.prototype, Promise, Number]) list(holder);
