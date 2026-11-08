import { test, mock } from "bun:test";
import * as ledger from "./ledger.mjs";
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".mjs";
test("one", async () => {
  mock.module("./ledger.mjs", async () => { await new Promise(() => {}); return { kind: "stand-in", turn: -1 }; });
  const asked = await import(name);
  console.log("SAID meanwhile", asked === ledger, globalThis.turns);
});
