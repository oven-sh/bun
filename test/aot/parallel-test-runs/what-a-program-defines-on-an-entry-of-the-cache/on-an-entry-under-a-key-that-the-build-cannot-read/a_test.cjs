const { test } = require("bun:test");
const entryOf = name => require.cache[require.resolve("./" + JSON.parse(`"${name}.cjs"`))];
test("the key of the entry is made as the test runs", () => {
  console.log("SAID", require("./defined.cjs").a, require("./deleted.cjs").a, require("./only-read.cjs").a);
  Object.defineProperty(entryOf("defined"), "exports", { value: { a: "fake" } });
  console.log("SAID", delete entryOf("deleted").exports, entryOf("only-read").exports.a);
  console.log("SAID", require("./defined.cjs")?.a, require("./deleted.cjs")?.a, require("./only-read.cjs")?.a);
});
