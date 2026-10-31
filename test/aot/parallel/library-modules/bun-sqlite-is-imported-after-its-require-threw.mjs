// globalThis.Error is undefined while require() loads bun:sqlite, and its body throws. An import() of the module, with Error back, runs the body again and gets the module.
const RealError = globalThis.Error;
globalThis.Error = undefined;
let threw = false;
try {
  console.log(1, typeof require("bun:sqlite").Database);
} catch (error) {
  threw = true;
  console.log(1, error.name);
}
globalThis.Error = RealError;
// A body that does not throw leaves nothing to ask.
if (!threw) throw new RealError("bun:sqlite loads without Error");
const { Database } = await import("bun:sqlite");
console.log(2, new Database(":memory:").query("select 1 as x").get().x, require("bun:sqlite").Database === Database);
