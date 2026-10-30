// globalThis.WeakMap is undefined while node:test loads: its body has defined its classes when a module that it asks for throws. What the next requires of node:test do.
// Plain Bun runs the body of the module again. An executable runs it once and keeps what it threw, as for a file of the program.
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
try {
  console.log(3, typeof require("node:test").test);
} catch (error) {
  thrown.push(error);
  console.log(3, error.name);
}
const isOneError = thrown.every(error => error === thrown[0]);
console.log(thrown.length, isOneError);
/* Output:
1 TypeError
2 TypeError
3 TypeError
3 true
*/
