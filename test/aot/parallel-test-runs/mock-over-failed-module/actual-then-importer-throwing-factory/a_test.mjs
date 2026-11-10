import { test, vi } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.x ?? it.default?.x), error => error.message.slice(0, 30));
test("t", async () => {
  vi.doMock("./part.cjs", () => { throw new Error("factory f"); });
  log.push(await said(vi.importActual("./part.cjs")));
  log.push(await said(import("./importer.mjs")));
  vi.doUnmock("./part.cjs");
  vi.doMock("./part.cjs", () => ({ x: "mock g" }));
  log.push(await said(vi.importActual("./part.cjs")));
  console.log("SAID", log.join(), globalThis.runs);
});
