import { jest, mock, test, vi } from "bun:test";
mock.module("./tax.mjs", async () => ({ rate: "mock of " + (await vi.importActual("./fx.mjs")).rate }));
vi.doMock("./fx.mjs", async original => ({ ...(await original()), rate: "second" }));
test("c", async () => {
  console.log("c tax", (await import("./tax.mjs")).rate);
  console.log("c fx", (await import("./fx.mjs")).rate);
  console.log("c sale", (await import("./sale.mjs")).sold());
});
