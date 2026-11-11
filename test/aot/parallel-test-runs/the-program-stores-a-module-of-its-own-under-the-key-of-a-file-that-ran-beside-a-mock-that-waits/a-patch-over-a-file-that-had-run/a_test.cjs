const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
test("t", async () => {
  const first = ask(); mock.module("./lib.cjs", () => ({ a: "mocked" })); const under = ask().a; require.cache[key] = fake(); const second = ask().a;
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", under, second, actual.a, globalThis.runsOfLib);
});
