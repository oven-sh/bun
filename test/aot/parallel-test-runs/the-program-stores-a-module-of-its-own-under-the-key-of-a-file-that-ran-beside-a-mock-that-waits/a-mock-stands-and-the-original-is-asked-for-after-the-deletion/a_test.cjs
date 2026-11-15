const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
test("t", async () => {
  vi.doMock("./lib.cjs", () => ({ a: "mocked" }));
  const first = ask().a; require.cache[key] = fake(); const second = ask().a; delete require.cache[key]; const third = ask().a;
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", first, second, third, actual.a, globalThis.runsOfLib);
});
