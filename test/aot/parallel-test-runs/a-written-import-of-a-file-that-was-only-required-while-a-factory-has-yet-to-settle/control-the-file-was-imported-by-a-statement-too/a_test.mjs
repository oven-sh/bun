// The loader holds the file: it is patched in place, and the import gets the module that is loaded.
import { mock, test } from "bun:test";
import ledger from "./ledger.cjs";
test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "mocked" }; });
  const asked = await import("./ledger.cjs");
  console.log("SAID meanwhile", asked.kind, asked.default === required, ledger === required, globalThis.turns);
});
