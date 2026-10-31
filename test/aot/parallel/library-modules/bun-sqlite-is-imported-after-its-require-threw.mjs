// globalThis.Error is undefined while require() loads bun:sqlite, and its body throws. An import() of the module, with Error back, runs the body again and gets the module.
const RealError = globalThis.Error;
globalThis.Error = undefined;
try {
  console.log(1, typeof require("bun:sqlite").Database);
} catch (error) {
  console.log(1, error.name);
}
globalThis.Error = RealError;
const { Database } = await import("bun:sqlite");
console.log(2, new Database(":memory:").query("select 1 as x").get().x, require("bun:sqlite").Database === Database);
