import { afterAll, jest, mock, test, vi } from "bun:test";
jest.mock("@made-up/tax", () => ({ rate: "aR", fee: () => "aF", default: { rate: "aR" } }));
test("a", async () => {
  Bun.gc(true);
  console.log("SAID a", (await import("./sale.mjs")).sold(), (await import("@made-up/tax")).rate);
  console.log("SAID a actual", jest.requireActual("@made-up/tax").fee());
});
test("a2", async () => {
  Bun.gc(true);
  vi.doUnmock("@made-up/tax");
  console.log("SAID a2", (await import("./sale.mjs")).sold(), (await import("@made-up/tax")).rate);
});
