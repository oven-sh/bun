import { afterAll, jest, mock, test, vi } from "bun:test";
test("c", async () => {
  vi.doMock("@made-up/tax", async () => ({ ...(await vi.importActual("@made-up/tax")), rate: "cR" }));
  console.log("SAID c", (await import("./sale.mjs")).sold(), (await import("@made-up/tax")).rate);
});
