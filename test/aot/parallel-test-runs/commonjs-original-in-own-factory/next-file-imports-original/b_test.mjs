import { mock, test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./tax.cjs", async () => ({ ...(await import("./tax.cjs")), rate: 9 }));
  console.log("SAID b", (await import("./sale.mjs")).sold());
});
