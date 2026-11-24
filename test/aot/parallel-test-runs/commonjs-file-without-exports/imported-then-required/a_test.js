const { expect, test } = require("bun:test");

test("a require() returns the imported module", async () => {
  await import("./plain.cjs");
  expect(require("./plain.cjs").__esModule).toBe(true);
  expect(globalThis.modes).toEqual(["strict"]);
});
