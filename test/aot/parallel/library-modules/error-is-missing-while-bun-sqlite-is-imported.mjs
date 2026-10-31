// globalThis.Error is undefined while import() loads bun:sqlite, and its body throws. An import() keeps what the body threw: the next one rejects with the same error.
// A require() behind them, with Error back, runs the body again and gets the module. What an import() behind that gets.
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
// A body that does not throw leaves nothing to ask.
if (thrown.length !== 2) throw new RealError("bun:sqlite loads without Error");
const { Database } = require("bun:sqlite");
console.log(3, new Database(":memory:").query("select 1 as x").get().x);
try {
  console.log(4, (await import("bun:sqlite")).Database === Database);
} catch (error) {
  console.log(4, error.name, error === thrown[0]);
}
console.log(5, thrown[0] === thrown[1]);
