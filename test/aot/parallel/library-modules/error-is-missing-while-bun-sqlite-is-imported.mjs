// globalThis.Error is undefined while import() loads bun:sqlite, and its body throws. What the next import() and a require() of the module do.
// An import() keeps what the body threw in plain Bun too. A require() behind it runs the body again there. An executable runs it once.
const RealError = globalThis.Error;
globalThis.Error = undefined;
const thrown = [];
for (const round of [1, 2]) {
  try {
    console.log(round, typeof (await import("bun:sqlite")).Database);
  } catch (error) {
    thrown.push(error);
    console.log(round, error.name);
  }
}
globalThis.Error = RealError;
try {
  console.log(3, typeof require("bun:sqlite").Database);
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
