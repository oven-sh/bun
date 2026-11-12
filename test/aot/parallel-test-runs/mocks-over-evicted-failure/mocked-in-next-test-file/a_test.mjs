import { test, vi } from "bun:test";
test("the failure is evicted", () => {
  vi.doMock("./lib.mjs", () => ({ a: "first" }));
  vi.doUnmock("./lib.mjs");
});
