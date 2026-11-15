const { test } = require("bun:test");
const kit = require("./kit.cjs");
test("the second test file", () => {
  console.log(kit.sum(3, 4), kit.loadHelper()());
});
