// mock.module() will patch the module in place: nothing waits for its factory, and the patch reaches what is imported meanwhile.
import { test, mock } from "bun:test";
import * as ledger from "./ledger.mjs";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".mjs";
test("one", async () => {
  mock.module("./ledger.mjs", async () => { await 0; return { kind: "stand-in", turn: -1 }; });
  const asked = await import(name);
  console.log("SAID meanwhile", asked === ledger, asked.kind, globalThis.turns);
  await spinEventLoop();
  console.log("SAID settled", asked.kind, ledger.kind, globalThis.turns);
});
