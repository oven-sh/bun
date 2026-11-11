import { test, vi, jest } from "bun:test";
test("t", async () => {
  const started = Promise.withResolvers(), gate = Promise.withResolvers();
  globalThis.started = started.resolve;
  globalThis.gate = gate.promise;
  const evaluating = import("./slow.js");
  await started.promise;
  vi.resetModules();
  const again = import("./slow.js");
  gate.resolve();
  const [first, second] = await Promise.all([evaluating, again]);
  console.log("SAID", first.slow, second.slow, second === first, globalThis.loads);
});
