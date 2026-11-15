import { mock, test, vi } from "bun:test";
test("b", async () => {
  await import("./fx.mjs");
  const ran = new Promise(resolve => (globalThis.ran = resolve));
  const pending = mock.module("./fx.mjs", async () => { await 0; return { rate: "mock " + (await import("./tax.mjs")).rate }; });
  // The file that the factory imports has run; the patch is still pending.
  await ran;
  console.log("SAID one", (await import("./sale.mjs")).sold());
  console.log("SAID two", (await import("./sale.mjs")).sold(), (await import("./tax.mjs")).under());
  vi.doMock("./fx.mjs", () => ({ rate: "last" }));
  console.log("SAID three", (await import("./sale.mjs")).sold());
});
