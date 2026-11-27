import { mock, vi, test } from "bun:test";
import * as own from "node:path";
test("a", async () => {
  mock.module("node:path", () => ({ basename: path => "mock of " + path }));
  console.log("SAID a", own.basename("/a/own.ts"), own.extname("/a/own.ts"));
  vi.resetModules();
  const { user } = await import("./user.mjs");
  console.log("SAID a", user(), own.basename("/a/own.ts"), own.extname("/a/own.ts"));
  vi.doUnmock("node:path");
  console.log("SAID a", own.basename("/a/own.ts"), own.extname("/a/own.ts"));
});
