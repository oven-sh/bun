import { jest, test, vi } from "bun:test";
vi.mock("./ledger.cjs", { spy: true });
test("the original spreads a generator", async () => {
  const ledger = await import("./ledger.cjs");
  console.log("SAID", ledger.rows, ledger.page, ledger.total());
});
