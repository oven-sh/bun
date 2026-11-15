import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  console.log((await import("./price.cjs")).total());
  mock.module("./tax.json", () => ({ rate: "mock" }));
  console.log((await import("./price.cjs")).total());
  vi.doUnmock("./tax.json");
  console.log((await import("./price.cjs")).total());
});
