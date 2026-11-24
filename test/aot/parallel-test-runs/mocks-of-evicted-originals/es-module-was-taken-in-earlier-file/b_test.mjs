import { jest, mock, test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./price.mjs", async () => {
    const price = await vi.importActual("./price.mjs");
    return { total: () => "mock of " + price.total() };
  });
  vi.doMock("./tax.mjs", () => ({ rate: "mock" }));
  console.log("mocked", (await vi.importActual("./price.mjs")).total());
  console.log((await import("./shop.mjs")).sold());
  vi.doUnmock("./tax.mjs");
  console.log("unmocked", (await vi.importActual("./price.mjs")).total());
  console.log((await import("./shop.mjs")).sold());
});
