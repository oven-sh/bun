import { jest, mock, test, vi } from "bun:test";
mock.module("./price.cjs", () => ({ total: () => "mock" }));
test("b", async () => {
  console.log((await import("./shop.cjs")).sold());
  mock.module("./tax.cjs", () => ({ rate: "mock" }));
  console.log("mocked", (jest.requireActual("./price.cjs")).total());
  console.log((await import("./shop.cjs")).sold());
  vi.doUnmock("./tax.cjs");
  console.log("unmocked", (jest.requireActual("./price.cjs")).total());
  console.log((await import("./shop.cjs")).sold());
});
