const { test, vi, jest, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.constructor.name }; } };
test("t", () => {
  const first = ask();
  console.log("SAID", key in require.cache, ((require.cache[key] = null), true));
  const second = ask();
  console.log("SAID", globalThis.runsOfLib, second === first, second.a);
});
