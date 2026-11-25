import { test, vi } from "bun:test";

test("a", async () => {
  vi.doMock("kit/first.mjs", () => ({ one: 10 }));
  vi.doMock("kit/second.mjs", () => ({ two: 20 }));
  vi.doMock("kit/more.cjs", () => { console.log("SAID factory of more.cjs"); return { other: 50 }; });
  console.log("SAID mock of first", (await import("kit/first.mjs")).one);
  console.log("SAID mock of second", (await import("kit/second.mjs")).two);
  console.log("SAID under the mocks", (await import("./reader.mjs")).look());
  vi.doUnmock("kit/first.mjs");
  vi.doUnmock("kit/second.mjs");
  vi.doUnmock("kit/more.cjs");
  console.log("SAID after all are removed", (await import("./reader.mjs")).look());
  console.log("SAID a new importer", (await import("./new-reader.mjs")).look());
});
