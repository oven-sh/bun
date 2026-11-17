const { test } = require("bun:test");
test("b", () => {
  console.log("b before", require("./dep.cjs").value());
  require("./helper.cjs");
  console.log("b after", require("./dep.cjs").value());
});
