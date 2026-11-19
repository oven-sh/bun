import { jest, test, vi } from "bun:test";
vi.mock("./ledger.cjs", async () => ({ ...(await vi.importActual("./ledger.cjs")), kept: 1 }));
test("the original spreads a generator", async () => {
  const ledger = await import("./ledger.cjs");
  console.log("SAID", ledger.rows, ledger.page, ledger.total());
});
