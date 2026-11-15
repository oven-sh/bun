import { afterEach, test, vi } from "bun:test";

afterEach(() => {
  vi.resetModules();
});

test("another file resets its modules", async () => {
  const { answer } = await import("./answer.mjs");
  console.log("c", answer);
});
