const { test, expect } = require("bun:test");
test("the pantry", () => {
  const { pantry } = require("./pantry.mjs");
  console.log("SAID test got:", pantry);
  expect(pantry).toBe('pantry sees [] undefined');
});
