import { test, vi, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  let failing;
  vi.doMock("./x.js", () => { called.resolve(); return failing = gate.promise.then(() => { throw new Error("late"); }); });
  const first = said(import("./x.js"));
  await called.promise;
  vi.doUnmock("./x.js");
  log.push("second " + await said(import("./x.js")));
  gate.resolve();
  log.push("first " + await first);
  vi.doMock("./x.js", () => ({ a: "third mock" })); vi.doUnmock("./x.js");
  log.push("actual " + await said(vi.importActual("./x.js")));
  log.push("last " + await said(import("./x.js")));
});
