const { test } = require("bun:test");
test("the child of an entry of the cache is the module object of another file", () => {
  console.log("SAID", require("./user.cjs").seen(), require("./lib.cjs").a);
  console.log("SAID", delete require.cache[require.resolve("./user.cjs")].children[0].exports);
  console.log("SAID", require("./lib.cjs")?.a, require("./" + JSON.parse('"lib.cjs"'))?.a, require("./user.cjs").seen());
});
