import { test } from "bun:test";
import * as ledger from "./ledger.mjs";
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".mjs";
test("two", async () => {
  console.log("SAID next", (await import(name)) === ledger, ledger.kind, globalThis.turns);
});
