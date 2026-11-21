import { vi, test } from "bun:test";
test("a", async () => {
  const own = await vi.importActual("node:path");
  const same = await import("node:path");
  vi.resetModules();
  vi.doMock("node:path", () => ({ basename: path => "mock of " + own.basename(path) }));
  console.log("SAID a", (await import("./user.mjs")).user(), own.basename("/a/own.ts"), same.basename("/a/same.ts"));
});
