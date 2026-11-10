import { test } from "bun:test";
import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
test("t", async () => {
const started = Promise.withResolvers(), gate = Promise.withResolvers();
globalThis.started = started.resolve;
globalThis.gate = gate.promise;
  const evaluating = import("./slow.js");
  await started.promise;
  const cache = load[["ca", "che"].join("")];
  const key = import.meta.dir + "/" + JSON.parse('["slow.js"]')[0];
  try {
    console.log("SAID deleted", delete cache[key]);
  } catch (error) {
    console.log("SAID threw", String(error.message).slice(0, 40));
  }
  gate.resolve();
  const first = await evaluating;
  const second = await import("./slow.js");
  console.log("SAID", second === first, globalThis.loads);
});
