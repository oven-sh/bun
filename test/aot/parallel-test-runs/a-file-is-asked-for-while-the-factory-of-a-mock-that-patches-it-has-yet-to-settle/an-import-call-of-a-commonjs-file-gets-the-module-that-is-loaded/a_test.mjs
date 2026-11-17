import { test, mock } from "bun:test";
import ledger from "./ledger.cjs";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".cjs";
test("one", async () => {
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "stand-in", turn: -1 }; });
  const asked = await import(name);
  console.log("SAID meanwhile", asked.default === ledger, globalThis.turns);
  await spinEventLoop();
  console.log("SAID settled", globalThis.turns);
});
