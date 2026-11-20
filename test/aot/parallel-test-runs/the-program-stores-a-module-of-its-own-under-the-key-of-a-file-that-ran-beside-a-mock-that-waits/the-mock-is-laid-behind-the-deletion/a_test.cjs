const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
test("t", async () => {
  require("./lib.cjs"); require.cache[key] = { exports: { a: "fake" } }; const second = require("./lib.cjs").a; delete require.cache[key];
  vi.doMock("./lib.cjs", async () => { await 0; return { a: "mocked" }; });
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", second, actual.a, actual.n, globalThis.runsOfLib);
});
