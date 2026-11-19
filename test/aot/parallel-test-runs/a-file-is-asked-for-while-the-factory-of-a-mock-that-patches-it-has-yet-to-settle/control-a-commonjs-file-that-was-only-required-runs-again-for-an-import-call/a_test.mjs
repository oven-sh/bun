// No import has loaded the file: the loader holds nothing of it, and the import call gets the original, which runs a second time.
import { test, mock } from "bun:test";
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".cjs";
test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "stand-in", turn: -1 }; });
  const asked = await import(name);
  console.log("SAID meanwhile", asked.default === required, globalThis.turns);
});
