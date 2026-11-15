const { test, expect } = require("bun:test");

test("three calls at once", async () => {
  const settled = await Promise.allSettled([1, 2, 3].map(() => import("./flaky.cjs")));
  expect(settled.map(each => each.reason.message)).toEqual(["run 1", "run 1", "run 1"]);
  expect(require("./flaky.cjs").value).toBe(2);
});
