import { test, vi } from "bun:test";
test("replaced", async () => {
  vi.resetModules();
  const called = Promise.withResolvers<void>();
  vi.doMock("./kept", () => (called.resolve(), new Promise(() => {})));
  const importing = import("./user");
  await called.promise;
  vi.doMock("./kept", () => ({ x: "second" }));
  console.log("SAID", "replaced", (await import("./user")).x, (await importing).x);
  vi.doUnmock("./kept");
});
