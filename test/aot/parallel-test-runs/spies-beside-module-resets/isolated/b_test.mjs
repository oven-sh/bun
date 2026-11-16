import { test, vi } from "bun:test";

test("reset", () => {
  vi.resetModules();
  console.log("reset");
});
