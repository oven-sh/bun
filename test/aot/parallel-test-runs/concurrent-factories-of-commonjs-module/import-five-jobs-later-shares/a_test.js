import { test, vi, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  let answering;
  vi.doMock("./x.cjs", () => { called.resolve(); return answering = gate.promise.then(() => ({ a: "value one" })); });
  const one = said(import("./x.cjs"));
  await called.promise;
  vi.doUnmock("./x.cjs");
  gate.resolve();
  await answering;
  for (let job = 0; job < 5; job++) await 0;
  const third = said(import("./x.cjs"));
  log.push("one " + await one);
  log.push("third " + await third);
  log.push("last " + await said(import("./x.cjs")));
});
