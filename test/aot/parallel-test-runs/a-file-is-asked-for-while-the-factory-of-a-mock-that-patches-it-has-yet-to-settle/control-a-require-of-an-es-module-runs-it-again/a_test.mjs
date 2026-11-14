import { test, mock } from "bun:test";
import { createRequire } from "node:module";
import * as ledger from "./ledger.mjs";
const require = createRequire(import.meta.url);
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".mjs";
test("one", async () => {
  mock.module("./ledger.mjs", async () => { await 0; return { kind: "stand-in", turn: -1 }; });
  const asked = require(name);
  console.log("SAID meanwhile", asked.kind, asked.turn, ledger.turn, globalThis.turns);
});
