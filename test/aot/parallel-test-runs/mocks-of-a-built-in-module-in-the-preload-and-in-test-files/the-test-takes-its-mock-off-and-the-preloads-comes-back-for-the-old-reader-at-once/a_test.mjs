import { test, mock, vi } from "bun:test";
test("a", async () => {
  console.log("SAID a before", globalThis.first.late(), (await import("./fresh-a.mjs")).late());
  mock.module("node:path", () => ({ sep: "of a" }));
  console.log("SAID a under", globalThis.first.late(), (await import("./fresh-a.mjs")).late());
  vi.doUnmock("node:path");
  console.log("SAID a off", globalThis.first.late(), (await import("./fresh-a.mjs")).late());
});
