import { jest, mock, test, vi } from "bun:test";
vi.mock("./tax.mjs", async importOriginal => ({ ...(await importOriginal()), name: "mock tax" }));
vi.mock("./fx.mjs");
test("a", async () => {
  console.log("a", (await import("./sale.mjs")).sold());
});
