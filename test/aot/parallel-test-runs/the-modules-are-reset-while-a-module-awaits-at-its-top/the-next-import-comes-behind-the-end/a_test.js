import { test, vi, jest } from "bun:test";
test("t", async () => {
  const started = Promise.withResolvers(), gate = Promise.withResolvers();
  globalThis.started = started.resolve;
  globalThis.gate = gate.promise;
  const evaluating = import("./slow.js");
  await started.promise;
  vi.resetModules();
  gate.resolve();
  const first = await evaluating;
  const second = await import("./slow.js");
  console.log("SAID", first.slow, second.slow, second === first, globalThis.loads);
});
