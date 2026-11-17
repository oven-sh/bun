const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
test("t", async () => {
  const first = ask(); vi.doMock("./lib.cjs", () => ({ a: "mocked", n: -1 })); const mocked = ask().a;
  require.cache[key] = { exports: { a: "fake" } }; const second = ask().a; delete require.cache[key];
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", mocked, second, actual.a, actual.n, actual.default === first, globalThis.runsOfLib);
});
