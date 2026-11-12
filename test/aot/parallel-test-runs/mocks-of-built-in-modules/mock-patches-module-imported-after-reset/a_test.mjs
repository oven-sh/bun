import { vi, test } from "bun:test";
import * as own from "node:path";
test("a", async () => {
  vi.resetModules();
  const before = await import("./user.mjs");
  vi.doMock("node:path", () => ({ basename: path => "mock of " + own.basename(path) }));
  const after = await import("./other.mjs");
  console.log("SAID a", before.user(), after.user(), own.basename("/a/own.ts"));
  vi.doUnmock("node:path");
  console.log("SAID a", before.user(), after.user(), own.basename("/a/own.ts"));
});
