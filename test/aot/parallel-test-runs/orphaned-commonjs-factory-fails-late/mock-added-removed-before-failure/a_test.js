import { test, vi, mock, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
afterAll(() => console.log("SAID", log.join(), "ran", globalThis.ran ?? 0, typeof mock));

test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  let failing;
  vi.doMock("./x.cjs", () => { called.resolve(); return failing = gate.promise.then(() => { throw new Error("late"); }); });
  const first = said(import("./x.cjs"));
  
  await called.promise;
  vi.doUnmock("./x.cjs");
  log.push("second " + await said(import("./x.cjs")));
  gate.resolve();
  await failing.catch(() => {}); await null;
  vi.doMock("./x.cjs", () => ({ a: "third mock" })); vi.doUnmock("./x.cjs");
  log.push("first " + await first);
  
  log.push("last " + await said(import("./x.cjs")));
});
