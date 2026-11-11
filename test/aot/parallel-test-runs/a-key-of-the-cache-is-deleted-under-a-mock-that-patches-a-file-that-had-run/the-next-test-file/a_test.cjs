const { test, vi, jest, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.constructor.name }; } };
test("t", async () => {
  const first = ask();
  const entry = require.cache[key];
  mock.module("./lib.cjs", () => ({ a: "mocked" }));
  delete require.cache[key];
  console.log("SAID", ask().a);
});
