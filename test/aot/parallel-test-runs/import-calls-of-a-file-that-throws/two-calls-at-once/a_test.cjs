const { test, expect } = require("bun:test");

test("two calls share the throw, and each require() runs the file again", async () => {
  const settled = await Promise.allSettled([import("./flaky.cjs"), import("./flaky.cjs")]);
  expect(settled.map(each => each.reason.message)).toEqual(["run 1", "run 1"]);
  expect(() => require("./flaky.cjs")).toThrow("run 2");
  expect(require("./flaky.cjs").value).toBe(3);
  await expect(import("./flaky.cjs")).rejects.toBe(settled[0].reason);
  expect(globalThis.runs).toBe(3);
});

test("one call keeps the error for imports", async () => {
  await expect(import("./once.cjs")).rejects.toThrow("once 1");
  expect(() => require("./once.cjs")).toThrow("once 2");
  await expect(import("./once.cjs")).rejects.toThrow("once 1");
});
