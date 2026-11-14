import { jest, mock, test, vi } from "bun:test";
jest.mock("./tax.mjs", () => { console.log("factory"); return { ...jest.requireActual("./tax.mjs"), name: "mock tax" }; });
vi.mock("./fx.mjs", { spy: true });
test("a", async () => {
  console.log("a", (await import("./sale.mjs")).sold());
});
