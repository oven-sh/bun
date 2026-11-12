import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  let failing;
  vi.doMock("./x.mjs", () => { called.resolve(); return failing = gate.promise.then(() => { throw new Error("late"); }); });
  const first = import("./x.mjs").then(it => it.member(), error => error.message);
  await called.promise;
  vi.doUnmock("./x.mjs");
  const second = await import("./x.mjs").then(it => it.member(), error => error.message);
  gate.resolve();
  await failing.catch(() => {});
  const firstWord = await first;
  await jobs(10);
  
  console.log("SAID", firstWord, second, "and now the call that nobody awaits");
  import("./x.mjs");
  await spinEventLoop();
  console.log("SAID the test went on");
});
