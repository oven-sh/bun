const { jest, test } = require("bun:test");
test("t", async () => {
  jest.resetModules();
  try { jest.doMock("./lib.mjs"); console.log("SAID it returned"); } catch (error) { console.log("SAID it threw", error.name); }
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name));
});
