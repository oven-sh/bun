import { test, vi, afterAll } from "bun:test";
const log = [];
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
const turn = () => new Promise(done => setImmediate(done));
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./x.js", async () => { called.resolve(); await gate.promise; log.push("settles"); throw new Error("late"); });
  import("./x.js");
  await called.promise;
  vi.doMock("./x.js", () => ({ a: "second mock" }));
  await import("./x.js").then(m => log.push("second " + m.a), e => log.push("second " + e.message));
  gate.resolve();
  await jobs(40);
  log.push("behind the wait");
  
});
test("u", () => { log.push("u runs"); });
