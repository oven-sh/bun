import { test, vi } from "bun:test";
test("what waits, and what is let go", async () => {
  let waits = true;
  const called = Promise.withResolvers<void>();
  vi.doMock("./kept", () => (called.resolve(), new Promise(() => {})));
  void (import("./user")).finally(() => (waits = false));
  await called.promise;
  vi.resetModules(); vi.doMock("./kept", () => ({ x: "second" }));
  console.log("SAID", (await import("./user")).x);
  await new Promise(resolve => setImmediate(resolve));
  console.log("SAID the first still waits:", waits);
  vi.doUnmock("./kept");
});
