const { test } = require("bun:test");
const { who } = require("made-up-pack/lib.cjs");
test("next", () => {
  console.log("SAID next", who);
});
