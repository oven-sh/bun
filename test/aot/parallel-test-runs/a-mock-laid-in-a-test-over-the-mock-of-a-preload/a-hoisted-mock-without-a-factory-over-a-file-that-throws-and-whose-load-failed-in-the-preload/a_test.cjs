const { jest, test } = require("bun:test");
jest.mock("./lib.mjs");
test("the file has died at its load", () => {
  console.log("SAID the test ran");
});
