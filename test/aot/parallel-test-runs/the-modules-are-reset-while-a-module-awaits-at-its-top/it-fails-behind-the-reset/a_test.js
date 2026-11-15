import { test, vi, jest } from "bun:test";
test("t", async () => {
  const started = Promise.withResolvers(), gate = Promise.withResolvers();
  globalThis.started = started.resolve;
  globalThis.gate = gate.promise;
  const evaluating = import("./slow.js").then(all => all.slow, error => error.message);
  await started.promise;
  vi.resetModules();
  gate.resolve();
  console.log("SAID", await evaluating, await import("./slow.js").then(all => all.slow, error => error.message), globalThis.loads);
});
