const { test } = require("bun:test");
void module.children;
const keys = () => Object.keys(require.cache).map(key => key.split("/").pop()).filter(name => !name.includes("_test")).join(" ");
test("t", () => {
  require("./x.cjs");
  require("./mid.cjs");
  require("./y.cjs");
  console.log("SAID", keys());
});
