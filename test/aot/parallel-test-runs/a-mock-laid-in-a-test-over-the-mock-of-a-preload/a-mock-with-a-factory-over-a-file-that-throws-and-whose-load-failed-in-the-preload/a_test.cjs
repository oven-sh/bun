const { jest, test } = require("bun:test");
test("an import goes on failing and a require gets the mock", async () => {
  jest.doMock("./lib.mjs", () => ({ a: "of the test" }));
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name));
  console.log("SAID", require("./lib.mjs").a);
});
