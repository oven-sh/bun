import { test, vi } from "bun:test";

test("the mocked module that re-exports the CommonJS file still shows the file's own value", async () => {
  vi.doMock("kit/first.mjs", () => ({ one: 10 }));
  vi.doMock("kit/more.cjs", () => ({ other: 50 }));
  console.log("mock of first", (await import("kit/first.mjs")).one);
  console.log("under the mocks", (await import("./reader.mjs")).look());
  vi.doUnmock("kit/first.mjs");
  vi.doUnmock("kit/more.cjs");
  console.log("after both are removed", (await import("./reader.mjs")).look());
  console.log("a new importer", (await import("./new-reader.mjs")).look());
});
