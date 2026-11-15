import { jest, mock, test, vi } from "bun:test";
mock.module("./price.cjs", () => ({ total: () => "mock" }));
test("b", async () => {
  vi.doMock("./tax.mjs", () => ({ rate: "mock" }));
  console.log("mocked", (jest.requireActual("./price.cjs")).total());
  vi.doUnmock("./tax.mjs");
  console.log("unmocked", (jest.requireActual("./price.cjs")).total());
});
