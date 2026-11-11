// Laying the first mock loads nothing by an import: the loader still holds nothing of the file, and the import call gets the original, which runs a second time.
import { test, mock } from "bun:test";
const name = (process.env.MADE_UP_NONE ?? "./ledger") + ".cjs";
test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", () => ({ kind: "first" }));
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "second" }; });
  const asked = await import(name);
  console.log("SAID meanwhile", asked.kind, asked.default === required, globalThis.turns);
});
