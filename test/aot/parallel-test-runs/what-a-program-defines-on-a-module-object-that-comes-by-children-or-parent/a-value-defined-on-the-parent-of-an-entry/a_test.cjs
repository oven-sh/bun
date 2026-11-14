const { test } = require("bun:test");
test("the parent of an entry of the cache is the module object of another file", () => {
  console.log("SAID", require("./lib.cjs").a, require("./user.cjs").seen());
  const parent = require.cache[require.resolve("./below.cjs")].parent;
  console.log("SAID", parent.id.endsWith("lib.cjs"));
  Object.defineProperty(parent, "exports", { value: { a: "fake" } });
  console.log("SAID", require("./lib.cjs")?.a, require("./" + JSON.parse('"lib.cjs"'))?.a, require("./user.cjs").seen());
});
