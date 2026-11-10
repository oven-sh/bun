import { test, vi, mock } from "bun:test";
const note = word => { globalThis.runs = (globalThis.runs ?? "") + word + " "; };
const asked = name => { try { return String(require(name).seen); } catch (error) { return "threw " + String(error?.message).slice(0, 22); } };
const tried = load => load.then(it => String(it.seen), error => "threw " + String(error?.message).slice(0, 22));
const later = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
let fails = 0;
test("a", async () => {
  vi.doMock("./wick.mjs", async original => { note("f<"); await 0; note("f-"); throw new Error("fails " + ++fails); });
  console.log(asked("./lamp.mjs"), "|", globalThis.runs);
  await later(30);
  console.log(asked("./lamp.mjs"), "|", globalThis.runs);
  console.log(asked("./lamp.mjs"), "|", globalThis.runs);
  await later();
  console.log("later", globalThis.runs, fails);
});
