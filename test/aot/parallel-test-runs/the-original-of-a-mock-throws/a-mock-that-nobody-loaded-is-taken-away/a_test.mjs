import { test, vi, mock } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.seen ?? it.x), error => error.message.slice(0, 30));
const plainly = tag => vi.doMock("./part.mjs", () => ({ x: "mock " + tag }));
const takes = tag => vi.doMock("./part.mjs", async original => { const own = await original(); return { ...own, x: "mock " + tag }; });
const actual = async () => log.push(await said(vi.importActual("./part.mjs")));
const user = async () => log.push(await said(import("./a.mjs")));
test("t", async () => {
  plainly("f");
  await actual();
  vi.doUnmock("./part.mjs");
  plainly("g");
  await actual();
  console.log("SAID", log.join(), globalThis.runs);
});
