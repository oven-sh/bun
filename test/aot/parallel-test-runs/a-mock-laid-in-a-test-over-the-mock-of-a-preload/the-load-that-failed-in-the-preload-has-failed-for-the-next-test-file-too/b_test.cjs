const { jest, test } = require("bun:test");
test("u", async () => {
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name));
  try { jest.doMock("./lib.mjs"); console.log("SAID it returned"); } catch (error) { console.log("SAID it threw", error.name); }
});
