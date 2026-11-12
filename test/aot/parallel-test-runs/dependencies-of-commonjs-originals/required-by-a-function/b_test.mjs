import { jest, mock, test, vi } from "bun:test";
mock.module("./price.cjs", () => ({ total: () => "mock" }));
test("b", async () => {
  vi.doMock("./tax.cjs", () => ({ rate: "mock" }));
  console.log("mocked", (await vi.importActual("./price.cjs")).total());
  vi.doUnmock("./tax.cjs");
  console.log("unmocked", (await vi.importActual("./price.cjs")).total());
});
