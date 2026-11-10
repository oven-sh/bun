import { test } from "bun:test";
let turns = 0, on = true;
const tick = () => { turns++; if (on) setImmediate(tick); };
const ask = async label => {
  const before = turns;
  const word = (await import("./late.mjs")).v;
  console.log("SAID", label, word, turns - before ? "LATER" : "same");
};
test("it", async () => {
  setImmediate(tick);
  await new Promise(done => setImmediate(done));
  await ask("first");
  await ask("again");
  on = false;
});
