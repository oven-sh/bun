const { expect, test } = require("bun:test");

test("a require() and an import() share one run of the file", async () => {
  const required = require("./plain.cjs");
  expect(Object.keys(required)).toEqual([]);
  const imported = await import("./plain.cjs");
  expect(imported.default).toBe(required);
  expect(await import("./plain.cjs")).toBe(imported);
  expect(require("./plain.cjs")).toBe(required);
  expect(globalThis.modes).toEqual(["sloppy"]);
});
