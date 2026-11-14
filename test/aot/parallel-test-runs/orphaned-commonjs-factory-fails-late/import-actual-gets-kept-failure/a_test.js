import { test, vi, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  let failing;
  vi.doMock("./x.cjs", () => { called.resolve(); return failing = gate.promise.then(() => { throw new Error("late"); }); });
  const first = said(import("./x.cjs"));
  await called.promise;
  vi.doUnmock("./x.cjs");
  log.push("second " + await said(import("./x.cjs")));
  gate.resolve();
  log.push("first " + await first);
  log.push("actual " + await said(vi.importActual("./x.cjs")));
  log.push("last " + await said(import("./x.cjs")));
});
