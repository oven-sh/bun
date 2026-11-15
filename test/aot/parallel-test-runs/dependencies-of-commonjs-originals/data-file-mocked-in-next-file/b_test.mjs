import { jest, mock, test, vi } from "bun:test";
mock.module("./price.cjs", () => ({ total: () => "mock" }));
test("b", async () => {
  mock.module("./tax.json", () => ({ rate: "mock" }));
  console.log("mocked", (await vi.importActual("./price.cjs")).total());
  vi.doUnmock("./tax.json");
  console.log("unmocked", (await vi.importActual("./price.cjs")).total());
});
