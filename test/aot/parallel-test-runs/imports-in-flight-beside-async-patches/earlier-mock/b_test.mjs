import { mock, test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./fx.mjs", () => ({ rate: "early" }));
  await import("./fx.mjs");
  const pending = mock.module("./fx.mjs", async () => { await 0; return { rate: "mock " + (await import("./tax.mjs")).rate }; });
  console.log("SAID one", (await import("./sale.mjs")).sold());
  console.log("SAID two", (await import("./sale.mjs")).sold(), (await import("./tax.mjs")).under());
  vi.doMock("./fx.mjs", () => ({ rate: "last" }));
  console.log("SAID three", (await import("./sale.mjs")).sold());
});
