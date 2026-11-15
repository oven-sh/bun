const { test, vi, mock, jest } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
test("t", async () => {
  globalThis.first = ask(); require.cache[key] = fake(); console.log("SAID", ask().a); delete require.cache[key];
});
