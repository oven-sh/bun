import { afterAll, jest, mock, test, vi } from "bun:test";
test("d", async () => {
  console.log("SAID d", (await import("./sale.mjs")).sold(), (await import("@made-up/tax")).rate);
  console.log("SAID d actual", (await vi.importActual("@made-up/tax")).fee());
});
