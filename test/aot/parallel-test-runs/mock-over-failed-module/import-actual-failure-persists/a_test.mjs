import { test, vi } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.x ?? it.default?.x), error => error.message.slice(0, 30));
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ x: "mock f" }));
  log.push(await said(vi.importActual("./part.cjs")));
  vi.doUnmock("./part.cjs");
  vi.doMock("./part.cjs", () => ({ x: "mock g" }));
  log.push(await said(vi.importActual("./part.cjs")));
  console.log("SAID", log.join(), globalThis.runs, process.argv.length > 9 ? 1 : 0);
});
