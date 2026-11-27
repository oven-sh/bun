import { test, vi } from "bun:test";
test("a reset in a later file", async () => {
  vi.resetModules();
  console.log("SAID behind a reset", (await import("./users.ts")).describePool());
});
