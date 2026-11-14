import { test, vi } from "bun:test";

test("a", async () => {
  vi.doMock("kit/more.cjs", () => ({ other: 50 }));
  console.log("SAID mocked " + (await import("./reader.mjs")).look());
  vi.doUnmock("kit/more.cjs");
  console.log("SAID unmocked " + (await import("./reader.mjs")).look());
  console.log("SAID new importer " + (await import("./new-reader.mjs")).look());
});
