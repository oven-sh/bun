import { afterAll, test, vi } from "bun:test";
const say = (...values) => console.log("SAID", ...values.map(value => JSON.stringify(value)));
const called = Promise.withResolvers();
test("one", () => {});
// The calls are made in the last hook of the file, so that no file is read between them and the end. The hook ends when the factory has its original, however fast its files are read: the calls are left in flight with the factory running.
afterAll(async () => {
  vi.doMock("./part.mjs", async original => {
    const it = await original();
    called.resolve();
    await null;
    return { ...it, more: 1 };
  });
  import("./part.mjs").then(it => say("call 1 came", it.v, it.more), error => say("call 1 failed", error.message));
  import("./part.mjs").then(it => say("call 2 came", it.v, it.more), error => say("call 2 failed", error.message));
  import("./part.mjs").then(it => say("call 3 came", it.v, it.more), error => say("call 3 failed", error.message));
  await called.promise;
});
