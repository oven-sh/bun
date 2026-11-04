// Two calls in one job lead to one mocked module. The first calls the factory, the second finds it called and not settled: both wait for the one promise.
import { mock, test } from "bun:test";

let calls = 0;
mock.module("./shared", async () => {
  console.log("factory call", ++calls);
  await new Promise(resolve => setTimeout(resolve, 10));
  console.log("factory ends");
  return { shared: "mock" };
});

test("both see the mock", async () => {
  const [first, second] = await Promise.all([import("./first"), import("./second")]);
  console.log("first", first.read(), "second", second.read(), "calls", calls);
});
