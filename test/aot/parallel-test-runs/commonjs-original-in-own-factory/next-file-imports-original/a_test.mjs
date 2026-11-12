import { mock, test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./tax.cjs", async () => ({ ...(await import("./tax.cjs")), rate: 9 }));
  console.log("SAID a", (await import("./sale.mjs")).sold());
});
