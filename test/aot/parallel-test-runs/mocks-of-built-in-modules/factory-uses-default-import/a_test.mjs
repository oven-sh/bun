import { vi, test } from "bun:test";
import own from "node:path";
test("a", async () => {
  vi.resetModules();
  vi.doMock("node:path", () => ({ ...own, basename: path => "mock of " + own.basename(path) }));
  const { user } = await import("./user.mjs");
  console.log("SAID a", user(), own.basename("/a/own.ts"));
  vi.doUnmock("node:path");
  console.log("SAID a", user(), own.basename("/a/own.ts"));
});
