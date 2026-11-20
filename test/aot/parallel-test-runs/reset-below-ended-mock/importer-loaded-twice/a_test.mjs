import { test, vi } from "vitest";
test("first file", async () => {
  vi.resetModules();
  await import("./account.mjs");
  vi.resetModules();
  console.log("SAID a", (await import("./account.mjs")).account());
});
