const { test, vi } = require("bun:test");
test("the import fails and nothing else is reported", async () => {
  vi.doMock("./lib.mjs");
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name));
});
