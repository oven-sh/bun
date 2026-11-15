import { jest, mock, test, vi } from "bun:test";
mock.module("./price.cjs", () => ({ total: () => "mock" }));
test("a", async () => {
  console.log("first", (jest.requireActual("./price.cjs")).total());
  mock.module("./tax.cjs", () => ({ rate: "mock" }));
  console.log("mocked", (jest.requireActual("./price.cjs")).total());
  vi.doUnmock("./tax.cjs");
  console.log("unmocked", (jest.requireActual("./price.cjs")).total());
});
