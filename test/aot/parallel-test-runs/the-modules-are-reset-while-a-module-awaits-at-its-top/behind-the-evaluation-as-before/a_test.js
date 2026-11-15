import { test, vi, jest } from "bun:test";
test("t", async () => {
  const first = await import("./slow.js");
  vi.resetModules();
  const second = await import("./slow.js");
  console.log("SAID", first.slow, second.slow, second === first, globalThis.loads);
});
