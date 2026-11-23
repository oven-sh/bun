const { test, expect } = require("bun:test");

test("the second call's fetch ends behind the throw: require() runs the file again", async () => {
  const settled = await Promise.allSettled([import("./flaky.cjs"), import("./flaky.cjs")]);
  expect(settled.map(each => each.reason.message)).toEqual(["run 1", "run 1"]);
  expect(() => require("./flaky.cjs")).toThrow("run 2");
  expect(() => require("./flaky.cjs")).toThrow("run 1");
  await expect(import("./flaky.cjs")).rejects.toBe(settled[0].reason);
  expect(globalThis.runs).toBe(2);
});

test("one call leaves the error to require()", async () => {
  await expect(import("./once.cjs")).rejects.toThrow("once 1");
  expect(() => require("./once.cjs")).toThrow("once 1");
});
