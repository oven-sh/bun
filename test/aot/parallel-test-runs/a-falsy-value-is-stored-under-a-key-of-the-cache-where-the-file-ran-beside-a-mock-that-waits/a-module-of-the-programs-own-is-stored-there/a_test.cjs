const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
test("t", () => {
  const first = ask(); require.cache[key] = { exports: { a: "fake" } }; const second = ask();
  delete require.cache[key]; const third = ask();
  console.log("SAID", String(second.a), String(third.a), key in require.cache);
});
