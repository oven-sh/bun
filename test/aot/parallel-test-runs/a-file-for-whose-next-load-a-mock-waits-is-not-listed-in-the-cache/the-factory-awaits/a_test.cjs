const { test } = require("bun:test");
test("t", async () => {
  const key = require.resolve("./part.cjs");
  console.log("SAID in the preload", listedInThePreload, requiredByThePreload.a);
  console.log("SAID at the test", key in require.cache, Object.keys(require.cache).includes(key), typeof require.cache[key]);
  console.log("SAID imported", (await import("./part.cjs")).a);
  console.log("SAID behind the import", key in require.cache);
});
