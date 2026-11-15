import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
test("b", async () => {
  vi.doMock("./tax.mjs", async original => ({ ...(await original()), rate: "second" }));
  console.log("b actual", jest.requireActual("./tax.mjs").rate);
  console.log("b", (await import("./tax.mjs")).rate, (await import("./sale.mjs")).sold(), sold());
});
