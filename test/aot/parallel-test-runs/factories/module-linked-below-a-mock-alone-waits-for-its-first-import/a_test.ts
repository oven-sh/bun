// outer.ts is mocked, so no load has come to inner.ts, which outer.ts alone imports. A mock of inner.ts finds nothing loaded: its factory waits for the first import, and the body of inner.ts never runs.
import { mock, test } from "bun:test";

mock.module("./outer", () => ({ outer: "mock outer" }));

test("the factory waits", async () => {
  console.log("outer", (await import("./outer")).outer);
  mock.module("./inner", () => {
    console.log("the factory of inner");
    return { inner: "mock inner" };
  });
  console.log("behind the call");
  console.log("inner", (await import("./inner")).inner);
});
