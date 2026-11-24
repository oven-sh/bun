import { test, vi } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.seen ?? it.x), error => error.message.slice(0, 30));
const plainly = tag => vi.doMock("./part.mjs", () => ({ x: "mock " + tag }));
const actual = async () => log.push(await said(vi.importActual("./part.mjs")));
test("t", async () => {
  plainly("f");
  await actual();
  vi.doUnmock("./part.mjs");
  log.push(await said(import("./part.mjs")));
  plainly("g");
  vi.doUnmock("./part.mjs");
  delete require.cache[require.resolve("./part.mjs")];
  plainly("h");
  await actual();
  console.log("SAID", log.join(), globalThis.runs);
});
