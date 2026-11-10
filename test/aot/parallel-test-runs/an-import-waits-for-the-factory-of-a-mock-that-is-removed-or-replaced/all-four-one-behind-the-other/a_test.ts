import { test, vi } from "bun:test";
test("removed, the module", async () => {
  vi.resetModules();
  const called = Promise.withResolvers<void>();
  vi.doMock("./kept", () => (called.resolve(), new Promise(() => {})));
  const importing = import("./user");
  await called.promise;
  vi.doUnmock("./kept");
  console.log("SAID", "removed, the module", (await import("./kept")).x, (await importing).x);
  vi.doUnmock("./kept");
});
test("replaced, the module", async () => {
  vi.resetModules();
  const called = Promise.withResolvers<void>();
  vi.doMock("./kept", () => (called.resolve(), new Promise(() => {})));
  const importing = import("./user");
  await called.promise;
  vi.doMock("./kept", () => ({ x: "second" }));
  console.log("SAID", "replaced, the module", (await import("./kept")).x, (await importing).x);
  vi.doUnmock("./kept");
});
test("removed, what waits", async () => {
  vi.resetModules();
  const called = Promise.withResolvers<void>();
  vi.doMock("./kept", () => (called.resolve(), new Promise(() => {})));
  const importing = import("./user");
  await called.promise;
  vi.doUnmock("./kept");
  console.log("SAID", "removed, what waits", (await import("./user")).x, (await importing).x);
  vi.doUnmock("./kept");
});
test("replaced, what waits", async () => {
  vi.resetModules();
  const called = Promise.withResolvers<void>();
  vi.doMock("./kept", () => (called.resolve(), new Promise(() => {})));
  const importing = import("./user");
  await called.promise;
  vi.doMock("./kept", () => ({ x: "second" }));
  console.log("SAID", "replaced, what waits", (await import("./user")).x, (await importing).x);
  vi.doUnmock("./kept");
});
