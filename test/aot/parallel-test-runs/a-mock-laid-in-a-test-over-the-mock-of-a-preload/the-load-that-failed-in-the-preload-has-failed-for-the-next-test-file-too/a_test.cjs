const { jest, test } = require("bun:test");
test("t", async () => {
  jest.doMock("./lib.mjs", () => ({ a: "of the first file" }));
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name));
});
