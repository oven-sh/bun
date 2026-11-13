import { test, vi } from "bun:test";
const heard = load => load.then(it => "got " + (it.width ?? it.seen), error => error.message);
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("a", async () => {
  globalThis.holdsFactories = true;
  const held = heard(import("./lamp.mjs"));
  await globalThis.firstCall;
  const first = heard(import("./wick.mjs"));
  await spinEventLoop();
  vi.doMock("./wick.mjs", () => ({ width: "second" }));
  const lantern = await heard(import("./lantern.mjs"));
  globalThis.holdsFactories = false;
  for (const open of globalThis.gates.splice(0)) open();
  console.log(lantern, "|", await held, "|", await first);
  await spinEventLoop();
  console.log(globalThis.calls);
});
