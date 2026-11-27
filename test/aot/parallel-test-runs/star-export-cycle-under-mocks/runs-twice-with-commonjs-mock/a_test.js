import { test, vi } from "bun:test";

const look = async () => (await import("./reader.mjs")).look();
test("the second pass reads what the first read", async () => {
  vi.doMock("kit/more.cjs", () => ({ other: 50 }));
  vi.doMock("kit/first.mjs", () => ({ one: 10 }));
  vi.doMock("kit/second.mjs", () => ({ two: 20 }));
  console.log("mock of first", (await import("kit/first.mjs")).one);
  console.log("mock of second", (await import("kit/second.mjs")).two);
  console.log("under the mocks, round 1", await look());
  vi.doUnmock("kit/first.mjs");
  vi.doUnmock("kit/second.mjs");
  console.log("after the mocks, round 1", await look());
  vi.doUnmock("kit/more.cjs");
  console.log("after all are removed", await look());
});
