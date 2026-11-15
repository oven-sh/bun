import { jest, mock, test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./price.mjs", () => ({ total: () => "mock" }));
  vi.doMock("./tax.mjs", () => ({ rate: "mock" }));
  console.log("mocked", (jest.requireActual("./price.mjs")).total());
  console.log((await import("./shop.mjs")).sold());
  vi.doUnmock("./tax.mjs");
  console.log("unmocked", (jest.requireActual("./price.mjs")).total());
  console.log((await import("./shop.mjs")).sold());
});
