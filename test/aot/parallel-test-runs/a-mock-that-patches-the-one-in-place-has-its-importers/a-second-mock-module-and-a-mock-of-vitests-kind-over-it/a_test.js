import { test, vi, mock } from "bun:test";
test("who was linked under the first mock keeps the second under a later mock that waits", async () => {
  mock.module("pack/lib.cjs", () => ({ kept: 10 }));
  mock.module("pack/side.cjs", () => ({ side: 70 }));
  const { look } = await import("./user.mjs");
  console.log("SAID under the first mock", look());
  mock.module("pack/lib.cjs", () => ({ kept: 20 }));
  console.log("SAID under the second mock", look());
  vi.doMock("pack/lib.cjs", () => ({ kept: 30 }));
  console.log("SAID under the mock that waits", look());
});
