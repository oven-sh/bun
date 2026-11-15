import { mock, test } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
// An import of a fresh file goes through the whole loader: when four have come in turn, one that was requested before them has arrived.
let pebble = 0;
const settle = async () => { for (let count = 0; count < 4; count++) await import(`./pebble${pebble++}.js`); await spinEventLoop(); };
const call = Promise.withResolvers(), firstGate = Promise.withResolvers(), third = Promise.withResolvers(), secondGate = Promise.withResolvers();
test("a", async () => {
  mock.module("./m.js", async () => {
    console.log("SAID factory");
    call.resolve();
    await firstGate.promise;
    const it = await import("./third.js");
    third.resolve();
    await secondGate.promise;
    console.log("SAID factory settles");
    return { b: "mock b", c: "mock " + typeof it.t };
  });
  const first = import("./user.js");
  const same = import("./third.js");
  await call.promise;
  await settle();
  firstGate.resolve();
  await third.promise;
  const late = await import("./other.js");
  secondGate.resolve();
  console.log("SAID a", (await first).a, (await same).t(), late.o);
});
