import { test, vi } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.seen ?? it.x), error => error.message.slice(0, 30));
const plainly = tag => vi.doMock("./part.mjs", () => ({ x: "mock " + tag }));
const actual = async () => log.push(await said(vi.importActual("./part.mjs")));
test("t", async () => {
  vi.doMock("./part.mjs", () => { throw new Error("factory fails"); });
  log.push(await said(import("./part.mjs")));
  await actual();
  vi.doUnmock("./part.mjs");
  plainly("g");
  await actual();
  console.log("SAID", log.join(), globalThis.runs);
});
