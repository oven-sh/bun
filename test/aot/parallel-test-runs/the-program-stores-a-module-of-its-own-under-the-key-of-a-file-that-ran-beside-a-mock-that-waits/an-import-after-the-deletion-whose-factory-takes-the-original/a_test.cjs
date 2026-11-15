const { test, vi, mock, jest } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
test("t", async () => {
  const first = ask(); require.cache[key] = fake(); const second = ask();
  delete require.cache[key]; const all = await import("./lib.cjs");
  console.log("SAID", globalThis.runsOfLib, second.a, all.a, ask().a);
});
