import { test, vi } from "vitest";
test("first file", async () => {
  vi.resetModules();
  await import("./base.mjs");
  vi.resetModules();
  console.log("SAID a", (await import("./base.mjs")).base);
});
