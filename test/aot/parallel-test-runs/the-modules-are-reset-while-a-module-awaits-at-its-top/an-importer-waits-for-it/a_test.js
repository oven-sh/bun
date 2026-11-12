import { test, vi, jest } from "bun:test";
test("t", async () => {
  const started = Promise.withResolvers(), gate = Promise.withResolvers();
  globalThis.started = started.resolve;
  globalThis.gate = gate.promise;
  const evaluating = import("./user.js");
  await started.promise;
  vi.resetModules();
  gate.resolve();
  const first = await evaluating;
  const second = await import("./user.js");
  console.log("SAID", first.seen(), second.seen(), second === first, globalThis.loads, globalThis.users);
});
