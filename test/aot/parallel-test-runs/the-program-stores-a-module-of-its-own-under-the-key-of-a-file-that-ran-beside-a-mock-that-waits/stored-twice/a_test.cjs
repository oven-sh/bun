const { test, vi, mock, jest } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
test("t", async () => {
  const first = ask(); require.cache[key] = fake(); const second = ask(); require.cache[key] = { exports: { a: "other" } }; const other = ask();
  delete require.cache[key]; const third = ask();
  console.log("SAID", globalThis.runsOfLib, second.a, other.a, third === first, third.a);
});
