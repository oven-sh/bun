import { afterAll, jest, mock, test, vi } from "bun:test";
mock.module("@made-up/tax", () => ({ rate: "aR", fee: () => "aF", default: { rate: "aR" } }));
test("a", async () => {
  console.log("SAID a", (await import("./sale.mjs")).sold(), (await import("@made-up/tax")).rate);
  console.log("SAID a actual", (await vi.importActual("@made-up/tax")).fee());
});
