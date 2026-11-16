const { jest, test } = require("bun:test");
test("the original is the namespace that the mock was made of", () => {
  const original = jest.requireActual("./lib.mjs");
  console.log("SAID", Object.prototype.toString.call(original), Object.keys(original).join(), original.a);
});
