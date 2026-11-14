import { mock, test, vi } from "bun:test";
test("both are patches in place", async () => {
  const outer = await import("./outer.js");
  await mock.module("./inner.js", async () => ({ a: "mock of inner" }));
  await mock.module("./outer.js", async () => ({ a: "mock of outer" }));
  console.log("SAID", outer.a);
});
