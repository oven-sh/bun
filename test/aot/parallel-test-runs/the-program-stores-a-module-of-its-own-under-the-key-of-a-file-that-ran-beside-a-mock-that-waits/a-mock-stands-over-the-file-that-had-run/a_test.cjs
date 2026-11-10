const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
test("t", async () => {
  require("./lib.cjs"); vi.doMock("./lib.cjs", () => ({ a: "mocked", n: -1 })); const first = require("./lib.cjs").a;
  require.cache[key] = { exports: { a: "fake" } }; const second = require("./lib.cjs").a; delete require.cache[key];
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", first, second, actual.a, actual.n, globalThis.runsOfLib);
});
