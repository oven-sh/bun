// A helper that a test writes and loads from disk is interpreted. Its parent is the module object of the compiled file that required it. The second test file finds the same.
const { test } = require("bun:test");
const kit = require("./kit.cjs");
test("the first test file", () => {
  console.log(kit.sum(1, 2), kit.loadHelper()());
});
