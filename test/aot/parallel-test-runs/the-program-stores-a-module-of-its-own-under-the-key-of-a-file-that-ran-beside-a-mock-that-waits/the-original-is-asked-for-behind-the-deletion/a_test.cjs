const { test, vi, mock, jest } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
test("t", async () => {
  const first = ask(); require.cache[key] = fake(); delete require.cache[key];
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", globalThis.runsOfLib, actual.a, actual.default === first, ask() === first);
});
