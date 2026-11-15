const { jest, test } = require("bun:test");
test("the original is what a require of the file answers", () => {
  console.log("SAID", typeof module.require("./lib.cjs"), typeof jest.requireActual("./lib.cjs"));
});
