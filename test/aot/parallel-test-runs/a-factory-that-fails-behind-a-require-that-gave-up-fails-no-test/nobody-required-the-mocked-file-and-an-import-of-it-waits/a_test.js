import { test, vi } from "bun:test";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = name => { try { return String(require(name).width); } catch (error) { return "threw " + error.name; } };
const imported = name => Promise.race([import(name).then(it => it.width, error => "threw " + error.name), turns(8).then(() => "waits")]);
let calls = 0;
test("a", async () => {
  vi.doMock("./wick.mjs", () => { calls++; return new Promise(() => {}); });
  console.log(await imported("./wick.mjs"), "|", calls, globalThis.wicks ?? 0);
});
