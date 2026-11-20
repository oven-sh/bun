import { jest, mock, test, vi } from "bun:test";
vi.mock("@made-up/tax", async importOriginal => { console.log("factory"); return { ...(await importOriginal()), rate: 2 }; });
test("a", async () => {
  console.log("a", await import("./sale.mjs").then(it => it.sold(), () => "failed"));
  console.log("side", (await import("./side.mjs")).side);
});
