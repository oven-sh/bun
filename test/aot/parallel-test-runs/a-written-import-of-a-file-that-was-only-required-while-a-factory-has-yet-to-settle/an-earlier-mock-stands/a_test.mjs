// Laying the first mock loads nothing by an import.
import { mock, test } from "bun:test";
test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", () => ({ kind: "first" }));
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "mocked" }; });
  const asked = await import("./ledger.cjs");
  console.log("SAID meanwhile", asked.kind, asked.default === required, globalThis.turns);
});
