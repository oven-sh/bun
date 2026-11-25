const { expect, test } = require("bun:test");

test("a require() and an import() run their own modules", async () => {
  expect(Object.keys(require("./plain.cjs"))).toEqual([]);
  expect(globalThis.modes).toEqual(["sloppy"]);
  const imported = await import("./plain.cjs");
  expect(globalThis.modes).toEqual(["sloppy", "strict"]);
  expect(await import("./plain.cjs")).toBe(imported);
  require("./plain.cjs");
  expect(globalThis.modes).toEqual(["sloppy", "strict"]);
});
