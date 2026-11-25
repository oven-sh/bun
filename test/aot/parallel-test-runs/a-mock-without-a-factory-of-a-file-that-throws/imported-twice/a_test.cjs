const { test, vi } = require("bun:test");
test("t", async () => {
  vi.doMock("./lib.mjs");
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name));
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name));
});
