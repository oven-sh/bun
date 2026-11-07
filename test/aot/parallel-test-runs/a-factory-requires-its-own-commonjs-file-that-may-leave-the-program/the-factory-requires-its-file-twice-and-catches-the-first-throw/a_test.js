import { test, vi } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.x ?? it.default?.x), error => error.message.slice(0, 30));
globalThis.calls = 0;
test("t", async () => {
  vi.doMock("./part.cjs", () => {
    globalThis.calls++;
    try { require("./part.cjs"); } catch (error) { log.push("caught " + error.message); }
    const it = require("./part.cjs");
    return { x: "mock over " + it.x };
  });
  log.push("one " + await said(import("./part.cjs")));
  console.log("SAID", log.join(), globalThis.calls, globalThis.ran ?? 0);
});
globalThis.neverCalled = () => { delete require.cache[require.resolve("./part.cjs")]; };
