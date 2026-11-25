import { test, jest, vi } from "bun:test";
const loaded = Promise.withResolvers();
test("first", async () => {
  jest.doMock("./dep.cjs", () => ({ value: () => "first" }));
  console.log((await import("./sub.mjs")).read());
});
test("second", async () => {
  jest.doMock("./dep.cjs", async () => {
    const original = await vi.importActual("./dep.cjs");
    loaded.resolve();
    return { ...original, extra: 1 };
  });
  console.log((await import("./sub.mjs")).read());
});
test("third", async () => {
  await loaded.promise;
  for (let job = 0; job < 10; job++) await 0;
  console.log((await import("./sub.mjs")).read());
});
