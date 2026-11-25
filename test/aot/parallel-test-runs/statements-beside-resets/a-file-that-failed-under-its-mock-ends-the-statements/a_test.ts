import { test, vi } from "bun:test";

test("loads what is broken", async () => {
  vi.resetModules();
  try {
    await import("./broken.ts");
  } catch (error: any) {
    console.log("a", error.message);
  }
});
