import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
jest.mock("@made-up/tax", () => ({ ...jest.requireActual("@made-up/tax"), rate: "aR" }));
test("a", async () => {
  console.log("SAID a", await (await import("./sale.mjs")).sold());
});
