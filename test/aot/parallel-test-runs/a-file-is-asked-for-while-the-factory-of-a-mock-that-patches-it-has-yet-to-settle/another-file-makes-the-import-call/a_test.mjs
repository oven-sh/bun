import { test, mock } from "bun:test";
import * as ledger from "./ledger.mjs";
import * as clerk from "./clerk.mjs";
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".mjs";
const nameOfClerk = (process.env.MADE_UP_NOTHING ?? "./clerk") + ".mjs";
test("one", async () => {
  const gate = Promise.withResolvers();
  mock.module("./ledger.mjs", async () => { await gate.promise; return { kind: "stand-in", turn: -1 }; });
  await import(nameOfClerk);
  const asked = await clerk.fetchIt(name);
  console.log("SAID meanwhile", asked === ledger, globalThis.turns);
  gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 5));
  console.log("SAID settled", asked.kind, (await import(nameOfClerk)) === clerk, globalThis.turns);
});
