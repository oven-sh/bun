import { test, vi, afterAll } from "bun:test";
const log = [];
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
const said = load => Promise.resolve(load).then(it => String(it.a ?? it.seen), error => error.message.slice(0, 30));
const asked = name => { try { return String(require(name).a); } catch (error) { return error.message.slice(0, 30); } };
afterAll(() => console.log("SAID", log.join(), "ran", globalThis.ran ?? 0));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./x.js", () => { called.resolve(); return gate.promise.then(() => { throw new Error("late"); }); });
  const first = said(import("./x.js"));
  await called.promise;
  vi.doUnmock("./x.js");
  log.push("second " + await said(import("./x.js")));
  gate.resolve();
  log.push("first " + await first);
  vi.resetModules();
  log.push("last " + await said(import("./x.js")));
});
