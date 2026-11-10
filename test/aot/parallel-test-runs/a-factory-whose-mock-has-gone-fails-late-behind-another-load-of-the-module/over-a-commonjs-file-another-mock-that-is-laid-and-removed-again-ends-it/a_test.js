import { test, vi, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
afterAll(() => console.log("SAID", log.join(), "ran", globalThis.ran ?? 0));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./x.cjs", () => { called.resolve(); return gate.promise.then(() => { throw new Error("late"); }); });
  const first = said(import("./x.cjs"));
  await called.promise;
  vi.doUnmock("./x.cjs");
  log.push("second " + await said(import("./x.cjs")));
  gate.resolve();
  log.push("first " + await first);
  vi.doMock("./x.cjs", () => ({ a: "third mock" }));
  vi.doUnmock("./x.cjs");
  log.push("last " + await said(import("./x.cjs")));
});
