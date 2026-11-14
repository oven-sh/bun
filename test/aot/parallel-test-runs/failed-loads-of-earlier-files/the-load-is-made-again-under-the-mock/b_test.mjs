import { jest, mock, test, vi } from "bun:test";
test("b", async () => {
  console.log("before", await import("./tax.mjs").then(it => it.below(), e => e.name));
  vi.doMock("@made-up/fx", () => ({ rate: "mock rate" }));
  console.log("under", await import("./tax.mjs").then(it => it.below(), e => e.name));
  vi.doUnmock("@made-up/fx");
  console.log("behind", await import("./tax.mjs").then(it => it.below(), e => e.name));
});
