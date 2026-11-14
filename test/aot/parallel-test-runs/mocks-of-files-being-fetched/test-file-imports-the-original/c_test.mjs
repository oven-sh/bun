import { jest, mock, test, vi } from "bun:test";
const loading = vi.importActual("./fx.mjs");
vi.doMock("./fx.mjs", () => ({ rate: "second" }));
test("c", async () => {
  console.log("c loaded", (await loading).rate);
  console.log("c fx", (await import("./fx.mjs")).rate);
  console.log("c sale", (await import("./sale.mjs")).sold());
  console.log("c actual", (await vi.importActual("./fx.mjs")).rate, jest.requireActual("./fx.mjs").rate);
});
