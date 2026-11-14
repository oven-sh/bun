import { vi, test } from "bun:test";
import { basename } from "node:path";
test("a", async () => {
  vi.resetModules();
  vi.doMock("node:path", () => ({ basename: path => "mock of " + basename(path) }));
  const { user } = await import("./user.mjs");
  console.log("SAID a", user(), basename("/a/own.ts"));
  vi.doUnmock("node:path");
  console.log("SAID a", user(), basename("/a/own.ts"));
});
