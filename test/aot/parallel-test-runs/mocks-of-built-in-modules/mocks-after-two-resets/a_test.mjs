import { vi, test } from "bun:test";
import * as own from "node:path";
test("a", async () => {
  vi.resetModules();
  vi.doMock("node:path", () => ({ basename: path => "first mock of " + own.basename(path) }));
  const first = await import("./user.mjs");
  vi.resetModules();
  vi.doMock("node:path", () => ({ basename: path => "second mock of " + own.basename(path) }));
  const second = await import("./other.mjs");
  console.log("SAID a", first.user(), second.user(), own.basename("/a/own.ts"));
});
