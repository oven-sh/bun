import { jest, mock, test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./price.cjs", () => ({ total: () => "mock" }));
  mock.module("./tax.mjs", () => ({ rate: "mock" }));
  console.log("mocked", (await vi.importActual("./price.cjs")).total());
  vi.doUnmock("./tax.mjs");
  console.log("unmocked", (await vi.importActual("./price.cjs")).total());
});
