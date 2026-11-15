// No import has loaded the file, so the loader holds nothing of it. The import comes from the file of the factory that has yet to settle: it gets the original, which runs a second time.
import { mock, test } from "bun:test";
test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "mocked" }; });
  const asked = await import("./ledger.cjs");
  console.log("SAID meanwhile", asked.kind, asked.default === required, globalThis.turns);
});
