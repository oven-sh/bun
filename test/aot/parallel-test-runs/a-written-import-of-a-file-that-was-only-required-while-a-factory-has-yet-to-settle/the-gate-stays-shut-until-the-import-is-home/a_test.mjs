// The patch reaches what was required, not the original that the import got.
import { mock, test } from "bun:test";
test("one", async () => {
  let open;
  const gate = new Promise(resolve => { open = resolve; });
  const required = require("./ledger.cjs");
  const laid = mock.module("./ledger.cjs", async () => { await gate; return { kind: "mocked" }; });
  const asked = await import("./ledger.cjs");
  console.log("SAID meanwhile", asked.kind, asked.default === required, globalThis.turns);
  open();
  await laid;
  console.log("SAID behind", asked.kind, required.kind, globalThis.turns);
});
