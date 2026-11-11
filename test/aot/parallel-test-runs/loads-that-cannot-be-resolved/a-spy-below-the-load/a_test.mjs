import { jest, mock, test, vi } from "bun:test";
vi.mock("@made-up/tax", { spy: true });
test("a", async () => {
  console.log("a", await import("./sale.mjs").then(it => it.sold(), () => "failed"));
  console.log("side", (await import("./side.mjs")).side);
});
