import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("@made-up/tax", async () => ({ ...(await import("@made-up/tax")), rate: "bR" }));
  console.log("SAID b", await (await import("./sale.mjs")).sold());
});
