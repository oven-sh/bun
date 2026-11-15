const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.constructor.name }; } };
test("t", () => {
  const first = ask();
  require.cache[key] = undefined;
  const second = ask();
  console.log("SAID", globalThis.runsOfLib, second === first, String(second.a), key in require.cache);
});
