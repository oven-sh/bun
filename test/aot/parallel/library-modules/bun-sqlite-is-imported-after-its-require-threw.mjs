// globalThis.Error is undefined while require() loads bun:sqlite, and its body throws. What an import() of the module does when Error is back.
// Plain Bun runs the body of the module again. An executable runs it once, and the import() rejects with what the require() threw.
const RealError = globalThis.Error;
globalThis.Error = undefined;
let thrown;
try {
  console.log(1, typeof require("bun:sqlite").Database);
} catch (error) {
  thrown = error;
  console.log(1, error.name);
}
globalThis.Error = RealError;
try {
  console.log(2, typeof (await import("bun:sqlite")).Database);
} catch (error) {
  console.log(2, error.name, error === thrown);
}
/* Output:
1 TypeError
2 TypeError true
*/
