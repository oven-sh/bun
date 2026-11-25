import { jest, mock, test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./price.cjs", async () => {
    const price = await vi.importActual("./price.cjs");
    return { total: () => "mock of " + price.total() };
  });
  mock.module("./tax.mjs", () => ({ rate: "mock" }));
  console.log("mocked", (await vi.importActual("./price.cjs")).total());
  vi.doUnmock("./tax.mjs");
  console.log("unmocked", (await vi.importActual("./price.cjs")).total());
});
