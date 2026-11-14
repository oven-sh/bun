import { test, vi } from "bun:test";
test("what waits, and what is let go", async () => {
  let waits = true;
  const called = Promise.withResolvers<void>();
  vi.doMock("./kept", () => (called.resolve(), new Promise(() => {})));
  void (import("./kept")).finally(() => (waits = false));
  await called.promise;
  vi.resetModules(); vi.doUnmock("./kept");
  console.log("SAID", (await import("./kept")).x);
  await new Promise(resolve => setImmediate(resolve));
  console.log("SAID the first still waits:", waits);
  vi.doUnmock("./kept");
});
