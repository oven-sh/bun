import { test, vi, mock } from "bun:test";
const note = word => { globalThis.runs = (globalThis.runs ?? "") + word + " "; };
const asked = name => { try { return String(require(name).seen); } catch (error) { return "threw " + String(error?.message).slice(0, 22); } };
const tried = load => load.then(it => String(it.seen), error => "threw " + String(error?.message).slice(0, 22));
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const failing = Promise.withResolvers();
let fails = 0;
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { note("f<"); await new Promise(done => setTimeout(done, 10)); note("f-"); failing.resolve(); throw new Error("fails " + ++fails); });
  console.log(asked("./lamp.mjs"), "|", globalThis.runs);
  await failing.promise;
  await spinEventLoop();
  console.log("later", globalThis.runs, fails);
});
