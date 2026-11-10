import { test, vi } from "bun:test";

test("a", async () => {
  vi.doMock("kit/more.cjs", () => ({ other: 50 }));
  console.log("SAID under the mocks", (await import("./reader.mjs")).look());
  vi.doUnmock("kit/more.cjs");
  console.log("SAID after all are removed", (await import("./reader.mjs")).look());
  console.log("SAID a new importer", (await import("./new-reader.mjs")).look());
});
