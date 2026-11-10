const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
test("t", async () => {
  const first = ask(); vi.doMock("./lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; });
  require.cache[key] = { exports: { a: "fake" } }; const second = ask().a; delete require.cache[key];
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", second, actual.a, actual.n, actual.default === first, globalThis.runsOfLib, (await import("./lib.cjs")).a);
});
