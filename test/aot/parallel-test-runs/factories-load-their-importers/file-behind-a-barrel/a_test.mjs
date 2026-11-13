import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./fx.mjs", async () => ({ rate: "mock " + (await import("./tax.mjs")).rate }));
  console.log("a", (await import("./sale.mjs")).sold());
  vi.doMock("./fx.mjs", () => ({ rate: "second" }));
  console.log("b", (await import("./sale.mjs")).sold());
});
