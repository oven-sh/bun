import { afterAll, test, vi } from "bun:test";
const log = [];
const said = load =>
  Promise.resolve(load).then(
    it => String(it.a),
    error => error.message.slice(0, 30),
  );
const jobs = async n => {
  for (let job = 0; job < n; job++) await 0;
};
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  log.push("zero " + (await said(import("./x.cjs"))));
  const called = Promise.withResolvers(),
    gate = Promise.withResolvers();
  let failing;
  vi.doMock("./x.cjs", () => {
    called.resolve();
    return (failing = gate.promise.then(() => {
      throw new Error("late");
    }));
  });
  const first = said(import("./x.cjs"));
  await called.promise;
  vi.doUnmock("./x.cjs");
  gate.resolve();
  log.push("first " + (await first));
  log.push("last " + (await said(import("./x.cjs"))));
  log.push("again " + (await said(import("./x.cjs"))));
});
