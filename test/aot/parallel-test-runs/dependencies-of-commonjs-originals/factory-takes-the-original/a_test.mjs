import { jest, mock, test, vi } from "bun:test";
vi.mock("./price.cjs", async () => {
  const price = await vi.importActual("./price.cjs");
  return { total: () => "mock of " + price.total() };
});
test("a", async () => {
  console.log("first", (await import("./price.cjs")).total());
  mock.module("./tax.cjs", () => ({ rate: "mock" }));
  console.log("mocked", (jest.requireActual("./price.cjs")).total());
  vi.doUnmock("./tax.cjs");
  console.log("unmocked", (jest.requireActual("./price.cjs")).total());
  console.log("imported", (await import("./price.cjs")).total());
});
