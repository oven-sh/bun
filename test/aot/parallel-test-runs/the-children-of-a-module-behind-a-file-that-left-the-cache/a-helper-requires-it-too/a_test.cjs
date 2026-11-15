const { test } = require("bun:test");
const key = require.resolve("./lib.cjs");
const helper = require("./helper.cjs");
test("t", () => {
  console.log("SAID", helper.ask(), helper.children());
  delete require.cache[key];
  console.log("SAID own", require("./lib.cjs").n, module.children.length);
  console.log("SAID helper", helper.ask(), helper.children());
});
