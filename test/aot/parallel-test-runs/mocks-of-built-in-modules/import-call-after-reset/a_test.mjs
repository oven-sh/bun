import { vi, test } from "bun:test";
test("a", async () => {
  await import("./user.mjs");
  vi.resetModules();
  console.log("SAID a", (await import("node:path")).basename("/a/own.ts"));
  vi.doMock("node:path", () => ({ basename: path => "mock of " + path }));
  console.log("SAID a", (await import("./user.mjs")).user(), (await import("node:path")).extname("/a/own.ts"));
});
