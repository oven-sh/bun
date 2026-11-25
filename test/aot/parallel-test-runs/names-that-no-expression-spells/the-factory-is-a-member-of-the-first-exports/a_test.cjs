const { test, expect } = require("bun:test");
const maker = require("./maker.js");
test("the factory is read off the object that the file began with", () => {
  console.log(maker.element(), maker.make("b"));
  expect(maker.element()).toBe("first a");
});
