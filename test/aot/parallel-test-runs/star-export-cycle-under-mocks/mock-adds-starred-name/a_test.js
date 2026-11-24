import { test, vi } from "bun:test";
const look = async () => (await import("./reader.mjs")).look();
test("a package keeps its originals where a mock adds a name that a star brings", async () => {
  vi.doMock("kit/first.mjs", () => ({ one: 10, other: "mock" }));
  vi.doMock("kit/second.mjs", () => ({ two: 20 }));
  console.log("mock of first", (await import("kit/first.mjs")).one);
  console.log("mock of second", (await import("kit/second.mjs")).two);
  console.log("under the mocks", await look());
  vi.doUnmock("kit/first.mjs");
  vi.doUnmock("kit/second.mjs");
  console.log("after the mocks", await look());
});
