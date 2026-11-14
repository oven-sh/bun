import { test, vi, jest } from "bun:test";
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./x.mjs", () => {
    called.resolve();
    return gate.promise.then(() => ({ a: "one" }));
  });
  const first = import("./top.mjs");
  await called.promise;
  jest.doMock("./x.mjs", () => ({ a: "two" }));
  gate.resolve();
  console.log((await first).a);
  console.log((await import("./top.mjs")).a, (await import("./above.mjs")).a, (await import("./beside.mjs")).a, (await import("./x.mjs")).a);
});
