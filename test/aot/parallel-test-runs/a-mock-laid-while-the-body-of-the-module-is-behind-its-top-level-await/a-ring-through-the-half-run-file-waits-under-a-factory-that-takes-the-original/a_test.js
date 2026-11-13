import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
// An import of a fresh file goes through the whole loader: when four have come in turn, one that was requested before them has arrived.
let pebble = 0;
const settle = async () => { for (let count = 0; count < 4; count++) await import(`./pebble${pebble++}.mjs`); await spinEventLoop(); };
const begun = Promise.withResolvers();
globalThis.begin = begun.resolve;
// Nothing can say that a promise of the ring never settles.
const within = (promise, name, ms) => Promise.race([promise, new Promise(done => setTimeout(done, ms, name + " waits"))]);
test("t", async () => {
  globalThis.gate = new Promise(done => { globalThis.openGate = done; });
  globalThis.tick = new Promise(done => { globalThis.passTick = done; });
  const kiln = import("./kiln.mjs");
  await begun.promise;
  vi.doMock("./kiln.mjs", async () => {
    await globalThis.tick;
    const real = await within(vi.importActual("./kiln.mjs"), "original", 1200);
    return { name: typeof real === "string" ? "mock, " + real : "mock, original given" };
  });
  const asked = vi.importActual("./shelf.mjs");
  await settle();
  globalThis.openGate();
  await spinEventLoop();
  globalThis.passTick();
  console.log("SAID r0", await within(asked.then(m => m.shelf), "asked", 3000), "|", await within(kiln.then(m => m.held), "kiln", 1000));
}, 9000);
