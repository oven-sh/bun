const { test } = require("bun:test");
test("b", () => {
  console.log("SAID b", require("./greeting.cjs").word);
});
