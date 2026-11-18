import { test, vi } from "bun:test";
import own from "node:path";
test("b", async () => {
  console.log("SAID b", own.basename("/a/own.ts"), (await import("./user.mjs")).user());
  vi.doMock("node:path", () => ({ basename: () => "mock of b" }));
  console.log("SAID b", (await import("./user.mjs")).user());
});
