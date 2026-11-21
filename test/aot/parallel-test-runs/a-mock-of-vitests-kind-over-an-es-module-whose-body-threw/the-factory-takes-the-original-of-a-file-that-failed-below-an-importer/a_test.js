import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
let calls = 0;
const takes = async original => { calls++; return { word: "over " + (await original()).word }; };
const ask = async (label, file = "./part.mjs") => {
  const word = await import(file).then(it => "came " + (it.word ?? it.above), error => error.message);
  console.log("SAID", label, "|", word, "| runs", globalThis.runs ?? 0, "| calls", calls);
};
test("t", async () => {
  await ask("the importer", "./above.mjs");
  vi.doMock("./part.mjs", takes);
  await ask("under the mock");
  await ask("the importer again", "./above.mjs");
  await spinEventLoop();
  console.log("SAID the test has lingered | runs", globalThis.runs ?? 0, "| calls", calls);
});
