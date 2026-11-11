import { test, vi, mock, jest, afterAll } from "bun:test";
const log = [];
const said = load => Promise.resolve(load).then(it => String(it.a), error => error.message.slice(0, 30));
const asked = name => { try { return String(require(name).a); } catch (error) { return error.message.slice(0, 30); } };
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
afterAll(() => console.log("SAID", log.join(), "ran", globalThis.ran ?? 0));
test("t", async () => {
  log.push("one " + await said(import("./imp.mjs")));
  vi.doMock("./part.mjs", async orig => { globalThis.calls = (globalThis.calls ?? "") + "t "; return { ...(await orig()), g: "t" }; });
  log.push("two " + await said(import("./imp.mjs")));
  log.push("three " + await said(import("./imp.mjs")), globalThis.calls);
});
