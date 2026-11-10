import { test, vi } from "bun:test";
const later = ms => new Promise(done => setTimeout(done, ms));
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
  await later(300);
  console.log("SAID the test has lingered | runs", globalThis.runs ?? 0, "| calls", calls);
});
