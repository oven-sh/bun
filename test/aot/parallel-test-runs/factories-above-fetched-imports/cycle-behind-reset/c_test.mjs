import { test, vi } from "vitest";
test("last file", async () => {
  vi.resetModules();
  await import("./other.mjs");
});
