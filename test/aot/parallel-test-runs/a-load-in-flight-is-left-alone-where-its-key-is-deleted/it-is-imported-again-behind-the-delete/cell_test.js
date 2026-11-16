import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("t", async () => {
  const started = Promise.withResolvers(), gate = Promise.withResolvers();
  globalThis.started = started.resolve;
  globalThis.gate = gate.promise;
  const key = require.resolve("./slow.js");
  const evaluating = import("./slow.js");
  await started.promise;
  console.log("SAID deleted", delete require.cache[key]);
  const joined = import("./slow.js");
  await spinEventLoop();
  gate.resolve();
  const first = await evaluating, second = await joined;
  console.log("SAID", second === first, globalThis.loads, first.slow, second.slow);
});
