const { jest, test } = require("bun:test");
test("t", async () => {
  let calls = 0;
  jest.doMock("./lib.mjs", () => { calls++; return { a: "of the test " + calls }; });
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name), calls, globalThis.runs);
  jest.resetModules();
  console.log("SAID", await import("./lib.mjs").then(got => got.a, error => error.name), calls, globalThis.runs);
  console.log("SAID", require("./lib.mjs").a, calls, globalThis.runs);
});
