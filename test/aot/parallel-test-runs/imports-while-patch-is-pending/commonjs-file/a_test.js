import { test, jest } from "bun:test";
test("t", async () => {
  const gate = Promise.withResolvers();
  jest.doMock("./dep.cjs", () => ({ value: () => "first" }));
  const before = await import("./dep.cjs");
  jest.doMock("./dep.cjs", async () => {
    await gate.promise;
    return { value: () => "second" };
  });
  const during = await import("./dep.cjs");
  const { read } = await import("./late.mjs");
  console.log(before.value(), during.value(), read());
  gate.resolve();
  for (let job = 0; job < 10; job++) await 0;
  console.log(before.value(), during.value(), read(), (await import("./dep.cjs")).value());
});
