import { test, vi } from "bun:test";
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
test("the next file", async () => {
  const log = [];
  vi.doMock("./y.cjs", async () => { await 0; return { a: "fourth" }; });
  log.push("stranger " + await said(import("./y.cjs")));
  log.push("again " + await said(import("./y.cjs")));
  console.log("SAID next file", log.join());
});
