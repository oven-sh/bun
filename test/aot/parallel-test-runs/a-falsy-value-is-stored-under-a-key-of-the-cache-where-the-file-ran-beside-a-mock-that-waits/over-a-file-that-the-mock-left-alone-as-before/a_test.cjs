const { test, vi, jest, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.constructor.name }; } };
test("t", () => {
  const first = ask();
  vi.doMock("./lib.cjs", () => ({ a: "mocked" }));
  console.log("SAID", key in require.cache, ((require.cache[key] = undefined), true));
  const second = ask();
  console.log("SAID", globalThis.runsOfLib, second === first, second.a);
  vi.doUnmock("./lib.cjs");
  console.log("SAID", globalThis.runsOfLib, ask() === first, ask().a);
});
