import { mock, test } from "bun:test";
test("one", async () => {
  require("./ledger.cjs");
  await mock.module("./ledger.cjs", async () => { const real = await import("./ledger.cjs"); return { kind: "over " + real.kind }; });
  console.log("SAID behind", require("./ledger.cjs").kind, (await import("./ledger.cjs")).kind, globalThis.turns);
});
