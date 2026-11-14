import { jest, test, vi } from "bun:test";
import * as own from "node:path";
test("a", async () => {
  const { user } = await import("./user.mjs");
  console.log("SAID a", user(), own.basename("/a/own.ts"));
  jest.doMock("node:path", () => ({ basename: () => "mock of a" }));
  console.log("SAID a", user());
  vi.doUnmock("node:path");
  vi.resetModules();
  console.log("SAID a", (await vi.importActual("node:path")).basename("/a/actual.ts"));
});
