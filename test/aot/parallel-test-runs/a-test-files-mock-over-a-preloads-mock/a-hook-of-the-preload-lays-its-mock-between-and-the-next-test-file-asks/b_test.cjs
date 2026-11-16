const { test } = require("bun:test");
const ask = () => require("made-up-pack/lib.cjs").who;
console.log("SAID next at first", ask());
test("two", () => {
  console.log("SAID next in the test", ask());
});
