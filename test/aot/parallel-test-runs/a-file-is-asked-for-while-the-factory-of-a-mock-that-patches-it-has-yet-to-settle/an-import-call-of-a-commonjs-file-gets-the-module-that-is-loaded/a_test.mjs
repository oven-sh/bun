import { test, mock } from "bun:test";
import ledger from "./ledger.cjs";
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".cjs";
test("one", async () => {
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "stand-in", turn: -1 }; });
  const asked = await import(name);
  console.log("SAID meanwhile", asked.default === ledger, globalThis.turns);
  await new Promise(resolve => setTimeout(resolve, 5));
  console.log("SAID settled", globalThis.turns);
});
