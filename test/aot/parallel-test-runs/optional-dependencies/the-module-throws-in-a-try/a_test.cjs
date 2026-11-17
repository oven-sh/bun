const { test, expect } = require("bun:test");
try {
  var tools = require("./tools.mjs");
} catch (error) {
  console.log("caught", error.message);
}
test("the dependency failed while it loaded", () => {
  console.log(tools?.name, tools?.describe(), tools && tools.name, typeof tools);
  expect(tools?.name).toBe(undefined);
});
