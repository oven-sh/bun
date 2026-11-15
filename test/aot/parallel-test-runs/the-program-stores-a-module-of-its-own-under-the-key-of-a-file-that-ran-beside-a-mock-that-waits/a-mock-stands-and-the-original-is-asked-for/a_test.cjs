const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
test("t", async () => {
  vi.doMock("./lib.cjs", () => ({ a: "mocked" }));
  const first = require("./lib.cjs").a; require.cache[key] = { exports: { a: "fake" } };
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", first, require("./lib.cjs").a, actual.a, globalThis.runsOfLib);
});
