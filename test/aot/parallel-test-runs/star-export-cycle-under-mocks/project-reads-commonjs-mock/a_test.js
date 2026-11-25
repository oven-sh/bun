import { test, vi } from "bun:test";

test("the project sees the mock of the CommonJS file while the package sees the file", async () => {
  vi.doMock("kit/first.mjs", () => ({ one: 10 }));
  vi.doMock("kit/more.cjs", () => ({ other: 50 }));
  console.log("mock of first", (await import("kit/first.mjs")).one);
  console.log("under the mocks", (await import("./reader.mjs")).look());
  console.log("mock of more", (await import("kit/more.cjs")).other, require("kit/more.cjs").other);
  vi.doUnmock("kit/first.mjs");
  vi.doUnmock("kit/more.cjs");
  console.log("after both are removed", (await import("./reader.mjs")).look());
  console.log("more after the removal", (await import("kit/more.cjs")).other, require("kit/more.cjs").other);
  console.log("a new importer", (await import("./new-reader.mjs")).look());
});
