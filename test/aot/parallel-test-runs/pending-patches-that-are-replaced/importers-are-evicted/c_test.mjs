import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
test("c", async () => {
  jest.doMock("./tax.mjs", async () => {
    await 0;
    return { rate: "first" };
  });
  vi.doMock("./tax.mjs", () => ({ rate: "second" }));
  console.log("c", (await import("./tax.mjs")).rate, (await import("./sale.mjs")).sold(), sold());
});
