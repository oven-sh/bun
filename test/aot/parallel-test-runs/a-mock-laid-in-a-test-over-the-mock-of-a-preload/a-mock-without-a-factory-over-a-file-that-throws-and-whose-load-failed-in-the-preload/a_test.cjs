const { jest, test } = require("bun:test");
test("the call loads the original, which throws", () => {
  try {
    jest.doMock("./lib.mjs");
    console.log("SAID it returned");
  } catch (error) {
    console.log("SAID it threw", error.name);
  }
});
