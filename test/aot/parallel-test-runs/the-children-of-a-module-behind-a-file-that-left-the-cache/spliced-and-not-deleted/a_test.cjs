const { test } = require("bun:test");
const key = require.resolve("./lib.cjs");
test("t", () => {
  require("./lib.cjs");
  module.children.splice(0, module.children.length);
  console.log("SAID emptied", module.children.length);
  require("./lib.cjs");
  console.log("SAID again", module.children.length, module.children[0] === require.cache[key]);
});
