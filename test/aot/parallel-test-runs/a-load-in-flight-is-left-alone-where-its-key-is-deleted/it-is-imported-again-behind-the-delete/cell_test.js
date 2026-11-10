import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("t", async () => {
  const started = Promise.withResolvers(), gate = Promise.withResolvers();
  globalThis.started = started.resolve;
  globalThis.gate = gate.promise;
  const key = require.resolve("./slow.js");
  const evaluating = import("./slow.js");
  await started.promise;
  console.log("SAID deleted", delete require.cache[key]);
  const joined = import("./slow.js");
  await new Promise(done => setTimeout(done, 5));
  gate.resolve();
  const first = await evaluating, second = await joined;
  console.log("SAID", second === first, globalThis.loads, first.slow, second.slow);
});
