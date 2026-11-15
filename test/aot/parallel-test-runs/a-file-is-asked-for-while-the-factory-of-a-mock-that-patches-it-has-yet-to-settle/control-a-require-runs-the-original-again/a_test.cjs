// A require() cannot wait for the factory: it gets the original, which runs a second time.
const { test, mock } = require("bun:test");
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const first = require("./ledger.cjs");
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".cjs";
test("one", async () => {
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "stand-in", turn: -1 }; });
  const asked = require(name);
  console.log("SAID meanwhile", asked.kind, asked.turn, asked === first, globalThis.turns);
  await spinEventLoop();
  console.log("SAID settled", require(name).kind, globalThis.turns);
});
