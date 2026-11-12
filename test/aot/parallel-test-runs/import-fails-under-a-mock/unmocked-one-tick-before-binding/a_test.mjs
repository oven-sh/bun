import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const begun = Promise.withResolvers();
globalThis.begin = begun.resolve;
const describe = promise => promise.then(it => it.value + ", " + it.call(), error => "rejected with " + error.name);
test("the module fails while a mock is registered over it", async () => {
  let open;
  globalThis.gate = new Promise(resolve => {
    open = resolve;
  });
  const first = describe(import("./part.mjs"));
  await begun.promise;
  vi.doMock("./part.mjs", () => ({ value: "mock", call: () => "mock call" }));
  const second = describe(import("./part.mjs"));
  for (let tick = 0; tick < 4; tick++) await null;
  vi.doUnmock("./part.mjs");
  open();
  console.log("first:", await first);
  console.log("second:", await second);
  await spinEventLoop();
  console.log("later:", await describe(import("./part.mjs")));
  console.log("later again:", await describe(import("./part.mjs")));
  console.log("evaluations:", globalThis.evaluations);
});
