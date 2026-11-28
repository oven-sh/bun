const { expect, test } = require("bun:test");

test("a require() returns the exports of the file that was imported", async () => {
  const imported = await import("./plain.cjs");
  expect(require("./plain.cjs")).toBe(imported.default);
  expect(globalThis.modes).toEqual(["sloppy"]);
});
