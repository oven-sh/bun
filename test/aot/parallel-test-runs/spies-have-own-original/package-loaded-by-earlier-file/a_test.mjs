import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
test("a", async () => {
  console.log("SAID a", await (await import("./sale.mjs")).sold());
  console.log("SAID a actual", (await vi.importActual("tax")).rate);
});
