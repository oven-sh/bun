const { jest, test } = require("bun:test");
test("the factory is called at the call", () => {
  try {
    jest.doMock("./lib.mjs", () => {
      throw new TypeError("of the factory");
    });
    console.log("SAID it returned");
  } catch (error) {
    console.log("SAID it threw", error.name);
  }
});
