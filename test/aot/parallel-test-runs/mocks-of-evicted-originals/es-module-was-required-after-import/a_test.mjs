import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./price.mjs", () => ({ total: () => "mock" }));
  console.log((await import("./shop.mjs")).sold());
  console.log("first", (await vi.importActual("./price.mjs")).total());
  mock.module("./tax.mjs", () => ({ rate: "mock" }));
  console.log("mocked", (jest.requireActual("./price.mjs")).total());
  console.log((await import("./shop.mjs")).sold());
  vi.doUnmock("./tax.mjs");
  console.log("unmocked", (jest.requireActual("./price.mjs")).total());
  console.log((await import("./shop.mjs")).sold());
});
