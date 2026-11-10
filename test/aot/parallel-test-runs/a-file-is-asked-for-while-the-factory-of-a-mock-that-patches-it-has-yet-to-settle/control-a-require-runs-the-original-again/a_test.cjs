// A require() cannot wait for the factory: it gets the original, which runs a second time.
const { test, mock } = require("bun:test");
const first = require("./ledger.cjs");
const name = (process.env.MADE_UP_NOTHING ?? "./ledger") + ".cjs";
test("one", async () => {
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "stand-in", turn: -1 }; });
  const asked = require(name);
  console.log("SAID meanwhile", asked.kind, asked.turn, asked === first, globalThis.turns);
  await new Promise(resolve => setTimeout(resolve, 5));
  console.log("SAID settled", require(name).kind, globalThis.turns);
});
