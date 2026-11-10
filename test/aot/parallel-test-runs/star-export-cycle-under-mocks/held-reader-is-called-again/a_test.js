import { test, vi } from "bun:test";

test("a function kept from before the mocks were removed lists the same names", async () => {
  vi.doMock("kit/first.mjs", () => ({ one: 10 }));
  vi.doMock("kit/second.mjs", () => ({ two: 20 }));
  console.log("mock of first", (await import("kit/first.mjs")).one);
  console.log("mock of second", (await import("kit/second.mjs")).two);
  const { look } = await import("./reader.mjs");
  console.log("under the mocks", look());
  vi.doUnmock("kit/first.mjs");
  vi.doUnmock("kit/second.mjs");
  console.log("after both are removed", look());
  console.log("a new importer", (await import("./new-reader.mjs")).look());
});
