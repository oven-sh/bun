const { test } = require("bun:test");
test("a", () => {
  require("./helper.cjs");
  console.log("a", require("./dep.cjs").value());
});
