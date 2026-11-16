import { test, vi } from "bun:test";
test("a", () => {
  vi.resetModules();
  console.log("one a");
});
