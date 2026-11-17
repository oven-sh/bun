import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
jest.mock("./tax.mjs", () => { console.log("factory"); return { ...jest.requireActual("./tax.mjs"), name: "mock tax" }; });
vi.mock("./fx.mjs", { spy: true });
test("a", () => {
  console.log("a", sold());
});
