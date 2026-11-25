import { mock, test, vi } from "bun:test";
test("b", async () => {
  const pending = mock.module("@made-up/fx", async () => { await 0; return { rate: "mock " + (await import("./tax.mjs")).rate }; });
  console.log("SAID one", (await import("./sale.mjs")).sold());
  console.log("SAID two", (await import("./sale.mjs")).sold(), (await import("./tax.mjs")).under());
  vi.doMock("@made-up/fx", () => ({ rate: "last" }));
  console.log("SAID three", (await import("./sale.mjs")).sold());
});
