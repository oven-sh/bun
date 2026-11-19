import { test, vi, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
const asked = name => { try { return String(require(name).a); } catch (error) { return error.message.slice(0, 30); } };
afterAll(() => console.log("SAID", log.join(), "ran", globalThis.ran ?? 0));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  let failing;
  vi.doMock("./x.js", () => { called.resolve(); return failing = gate.promise.then(() => { throw new Error("late"); }); });
  const first = said(import("./x.js"));
  await called.promise;
  vi.doUnmock("./x.js");
  log.push("second " + await said(import("./x.js")));
  vi.doMock("./x.js", () => ({ a: "third mock" })); 
  gate.resolve();
  await failing.catch(() => {});
  
  log.push("first " + await first);
  
  log.push("last " + await said(import("./x.js")));
  log.push("again " + await said(import("./x.js")));
  log.push("required " + asked("./x.js"));
});
