import { afterAll, jest, mock, test, vi } from "bun:test";
test("c", async () => {
  jest.mock("@made-up/tax", () => ({ ...jest.requireActual("@made-up/tax"), rate: "cR" }));
  console.log("SAID c", (await import("./sale.mjs")).sold(), (await import("@made-up/tax")).rate);
});
