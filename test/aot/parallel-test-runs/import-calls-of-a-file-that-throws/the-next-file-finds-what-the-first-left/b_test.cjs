const { test, expect } = require("bun:test");

test("require() has the second run, import() the first error", async () => {
  expect(require("./flaky.cjs").value).toBe(2);
  await expect(import("./flaky.cjs")).rejects.toThrow("run 1");
  expect(globalThis.runs).toBe(2);
});
