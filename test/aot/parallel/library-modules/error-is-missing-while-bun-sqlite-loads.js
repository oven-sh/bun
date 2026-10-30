// globalThis.Error is undefined while bun:sqlite loads: its body has defined the classes Statement and Database when `class SQLiteError extends Error` throws. What the next requires of the module do.
// Plain Bun runs the body of the module again. An executable runs it once and keeps what it threw, as for a file of the program.
const RealError = globalThis.Error;
globalThis.Error = undefined;
const thrown = [];
for (const round of [1, 2]) {
  try {
    console.log(round, typeof require("bun:sqlite").Database);
  } catch (error) {
    thrown.push(error);
    console.log(round, error.name);
  }
}
globalThis.Error = RealError;
try {
  const { Database } = require("bun:sqlite");
  console.log(3, new Database(":memory:").query("select 1 as x").get().x);
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
