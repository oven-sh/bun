const { test, vi, jest, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.constructor.name }; } };
test("t", async () => {
  const first = ask();
  ((require.cache[key] = undefined), true);
  const all = await import("./lib.cjs");
  console.log("SAID", globalThis.runsOfLib, first.a, all.a, ask().a);
});
