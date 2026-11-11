import { test, vi, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
const asked = name => { try { return String(require(name).a); } catch (error) { return error.message.slice(0, 30); } };
afterAll(() => console.log("SAID", log.join(), "ran", globalThis.ran ?? 0));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  let failing;
  vi.doMock("./x.cjs", () => { called.resolve(); return failing = gate.promise.then(() => { throw new Error("late"); }); });
  const first = said(import("./x.cjs"));
  const also = said(import("./x.cjs"));
  await called.promise;
  vi.doUnmock("./x.cjs");
  log.push("second " + await said(import("./x.cjs")));
  vi.doMock("./x.cjs", () => ({ a: "third mock" })); 
  gate.resolve();
  await failing.catch(() => {});
  vi.doUnmock("./x.cjs"); 
  log.push("first " + await first);
  log.push("also " + await also);
  
  log.push("last " + await said(import("./x.cjs")));
  log.push("again " + await said(import("./x.cjs")));
  log.push("required " + asked("./x.cjs"));
});
