import { mock, test, vi } from "bun:test";
import * as own from "node:path";
test("a", async () => {
  mock.module("node:path", () => ({ ...own, basename: () => "mock" }));
  vi.resetModules();
  console.log("SAID a", (await import("./user.mjs")).user());
  vi.doUnmock("node:path");
  console.log("SAID a", (await import("./user.mjs")).user());
});
