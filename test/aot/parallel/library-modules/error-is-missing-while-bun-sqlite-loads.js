// globalThis.Error is undefined while bun:sqlite loads: its body has defined the classes Statement and Database when `class SQLiteError extends Error` throws.
// The next require runs the body again, which defines the classes a second time, and the one behind it, with Error back, gets the module.
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
// A body that does not throw leaves nothing to ask.
if (thrown.length !== 2) throw new RealError("bun:sqlite loads without Error");
const { Database, Statement, SQLiteError } = require("bun:sqlite");
const database = new Database(":memory:");
const statement = database.query("select 1 as x");
console.log(3, statement.get().x, statement instanceof Statement, Object.getPrototypeOf(SQLiteError) === RealError);
let refused;
try {
  database.query("select from");
} catch (error) {
  refused = error;
}
console.log(4, refused instanceof SQLiteError, refused?.name);
console.log(5, thrown[0] === thrown[1], require("bun:sqlite").Database === Database);
