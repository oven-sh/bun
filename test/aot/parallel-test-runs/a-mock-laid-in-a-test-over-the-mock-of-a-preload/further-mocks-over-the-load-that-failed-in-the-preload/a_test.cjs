const { jest, mock, test, vi } = require("bun:test");
test("t", async () => {
  jest.doMock("./lib.mjs", () => ({ a: "first" }));
  mock.module("./lib.mjs", () => ({ a: "second" }));
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name), require("./lib.mjs").a);
  vi.doMock("./lib.mjs", () => ({ a: "third" }));
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name), require("./lib.mjs").a);
});
