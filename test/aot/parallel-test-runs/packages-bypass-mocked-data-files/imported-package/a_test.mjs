import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./tax.json", () => ({ rate: "mock", default: { rate: "mock" } }));
  console.log("tax", (await import("./tax.json")).rate);
  console.log("under", (await import("@made-up/price")).total());
  vi.doUnmock("./tax.json");
  console.log("behind", (await import("@made-up/price")).total());
});
