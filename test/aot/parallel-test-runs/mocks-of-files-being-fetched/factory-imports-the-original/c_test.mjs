import { jest, mock, test, vi } from "bun:test";
vi.mock("./tax.mjs", async () => ({ rate: "mock of " + (await vi.importActual("./fx.mjs")).rate }));
jest.mock("./fx.mjs", () => ({ ...jest.requireActual("./fx.mjs"), rate: "second" }));
test("c", async () => {
  console.log("c tax", (await import("./tax.mjs")).rate);
  console.log("c fx", (await import("./fx.mjs")).rate);
  console.log("c sale", (await import("./sale.mjs")).sold());
});
