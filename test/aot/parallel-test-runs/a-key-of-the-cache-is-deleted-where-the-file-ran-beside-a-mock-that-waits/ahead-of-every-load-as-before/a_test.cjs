const { test, vi, jest, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.constructor.name }; } };
test("t", () => {
  delete require.cache[key];
  const first = ask(), second = ask();
  console.log("SAID", globalThis.runsOfLib, second === first, second.a);
});
