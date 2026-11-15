import { mock, test } from "bun:test";
test("the factory awaits a turn before it imports its file", async () => {
  await mock.module("./price.mjs", async () => {
    await new Promise(done => setImmediate(done));
    return { ...(await import("./price.mjs")), price: () => "mock price" };
  });
  console.log((await import("./cart.mjs")).total(), (await import("./price.mjs")).labeled());
});
