const { test, vi } = require("bun:test");
vi.mock("./part.cjs", () => ({ a: "mocked" }));
test("t", () => {
  const key = require.resolve("./part.cjs");
  console.log("SAID in the preload", listedInThePreload, requiredByThePreload.a);
  console.log("SAID at the test", key in require.cache, Object.keys(require.cache).includes(key), typeof require.cache[key]);
  console.log("SAID required", require("./part.cjs").a);
  console.log("SAID behind the require", key in require.cache);
});
