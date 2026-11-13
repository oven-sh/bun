import { mock, test, vi } from "bun:test";
test("both are patches in place", async () => {
  const outer = await import("./outer.js");
  const gate = Promise.withResolvers();
  const patched = mock.module("./inner.js", async () => (await gate.promise, { a: "mock of inner" }));
  await mock.module("./outer.js", async () => ({ a: "mock of outer" }));
  gate.resolve();
  await patched;
  console.log("SAID", outer.a);
});
