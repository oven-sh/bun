import { test, vi } from "bun:test";

test("loads what is broken", async () => {
  vi.resetModules();
  try {
    await import("./broken.cjs");
  } catch (error: any) {
    console.log("a", error.message);
  }
});
