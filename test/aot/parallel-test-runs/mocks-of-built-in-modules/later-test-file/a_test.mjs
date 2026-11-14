import { vi, test } from "bun:test";
import * as own from "node:path";
test("a", async () => {
  vi.resetModules();
  vi.doMock("node:path", () => ({ basename: path => "mock of " + own.basename(path) }));
  console.log("SAID a", (await import("./user.mjs")).user(), own.basename("/a/own.ts"));
});
