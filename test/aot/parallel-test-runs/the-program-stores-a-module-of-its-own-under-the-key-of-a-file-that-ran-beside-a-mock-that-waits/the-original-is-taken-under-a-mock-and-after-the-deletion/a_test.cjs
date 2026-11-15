const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const own = m => (m && m.a !== undefined ? m : m && m.default) ?? {};
test("t", async () => {
  vi.doMock("./lib.cjs", () => ({ a: "mocked" })); const first = ask().a;
  const one = own(await vi.importActual("./lib.cjs")); const between = globalThis.runsOfLib;
  require.cache[key] = { exports: { a: "fake" } }; const second = ask().a; delete require.cache[key];
  const two = own(await vi.importActual("./lib.cjs"));
  console.log("SAID", first, one.a, between, second, two.a, two.n, globalThis.runsOfLib);
});
