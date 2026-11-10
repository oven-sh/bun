const { test, vi, jest, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.constructor.name }; } };
test("t", async () => {
  const first = ask();
  const entry = require.cache[key];
  jest.doMock("./lib.cjs", () => ({ a: "mocked" }));
  console.log("SAID", key in require.cache, require.cache[key] === entry, require.cache[key].exports.a);
  delete require.cache[key];
  console.log("SAID", key in require.cache, Object.keys(require.cache).includes(key));
  const second = ask();
  console.log("SAID", key in require.cache, require.cache[key] === entry, require.cache[key].exports === second);
  vi.doUnmock("./lib.cjs");
  console.log("SAID", key in require.cache, require.cache[key] === entry, require.cache[key]?.exports === first, globalThis.runsOfLib);
});
