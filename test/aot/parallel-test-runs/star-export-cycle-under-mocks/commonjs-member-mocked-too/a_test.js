import { test, vi } from "bun:test";

test("a package's own imports bypass the mock of its CommonJS file too", async () => {
  vi.doMock("kit/first.mjs", () => ({ one: 10 }));
  vi.doMock("kit/second.mjs", () => ({ two: 20 }));
  vi.doMock("kit/more.cjs", () => ({ other: 50 }));
  console.log("mock of first", (await import("kit/first.mjs")).one);
  console.log("mock of second", (await import("kit/second.mjs")).two);
  console.log("under the mocks", (await import("./reader.mjs")).look());
  vi.doUnmock("kit/first.mjs");
  vi.doUnmock("kit/second.mjs");
  vi.doUnmock("kit/more.cjs");
  console.log("after all are removed", (await import("./reader.mjs")).look());
  console.log("a new importer", (await import("./new-reader.mjs")).look());
});
