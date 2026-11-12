import { test, vi } from "bun:test";
test("removed", async () => {
  vi.resetModules();
  const called = Promise.withResolvers<void>();
  vi.doMock("./kept", () => (called.resolve(), new Promise(() => {})));
  const importing = import("./user");
  await called.promise;
  vi.doUnmock("./kept");
  console.log("SAID", "removed", (await import("./kept")).x, (await importing).x);
  vi.doUnmock("./kept");
});
