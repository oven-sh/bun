import { test, vi, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.name + " " + error.message.slice(0, 24));
afterAll(() => console.log("SAID", log.join()));
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./x.js", () => { called.resolve(); return gate.promise.then(() => ({ a: "value one" })); });
  const one = said(import("./x.js"));
  await called.promise;
  vi.doUnmock("./x.js");
  const behind = async (turns, load) => { for (let turn = 0; turn < turns; turn++) await null; return said(load()); };
  gate.resolve();
  const joiners = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(turns => behind(turns, () => import("./x.js")));
  log.push("one " + await one);
  log.push("joiners " + (await Promise.all(joiners)).join("|"));
  log.push("last " + await said(import("./x.js")));
});
