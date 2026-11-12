import { test, vi } from "bun:test";
test("a", async () => {
  console.log("SAID a", (await import("./user.mjs")).user());
  vi.resetModules();
  console.log("SAID a", (await import("./user.mjs")).user());
});
