import { test, vi, jest } from "bun:test";
const started = Promise.withResolvers(), gate = Promise.withResolvers();
globalThis.started = started.resolve;
globalThis.gate = gate.promise;
const evaluating = import("./slow.js");
await started.promise;
jest.resetModules();
gate.resolve();
const first = await evaluating;
test("t", async () => {
  const second = await import("./slow.js");
  console.log("SAID", first.slow, second.slow, second === first, globalThis.loads);
});
