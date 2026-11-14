import { mock, test, vi } from "bun:test";
test("both are patches in place", async () => {
  const outer = await import("./outer.js");
  await mock.module("./outer.js", async () => ({ a: "mock of outer" }));
  await mock.module("./inner.js", async () => ({ a: "mock of inner" }));
  console.log("SAID", outer.a);
});
