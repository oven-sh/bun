import { jest, mock, test, vi } from "bun:test";
mock.module("./price.cjs", () => ({ total: () => "mock" }));
test("a", async () => {
  console.log("first", (await vi.importActual("./price.cjs")).total());
  mock.module("./tax.cjs", () => ({ rate: "mock" }));
  console.log("mocked", (await vi.importActual("./price.cjs")).total());
  vi.doUnmock("./tax.cjs");
  console.log("unmocked", (await vi.importActual("./price.cjs")).total());
});
