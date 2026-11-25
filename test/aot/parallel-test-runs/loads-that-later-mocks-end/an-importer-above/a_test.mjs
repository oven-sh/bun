import { test, vi, mock } from "bun:test";
const rest = time => new Promise(done => setTimeout(done, time));
const show = m => String(m.seen ?? m.value);
const now = load => { try { return show(load()); } catch (e) { return "threw " + (e.message.startsWith("factory") ? e.message : e.name); } };
const later = async load => { try { const m = await Promise.race([load(), rest(60)]); return m === undefined ? "waits" : show(m); } catch (e) { return "threw " + (e.message.startsWith("factory") ? e.message : e.name); } };
let calls = 0;
test("a", async () => {
  vi.doMock("./dep.mjs", async () => { ++calls; console.log("factory 1"); await new Promise(() => {}); return { value: "mock1" }; });
  console.log("1", now(() => require("./app.mjs")));
  vi.doUnmock("./dep.mjs");
  vi.doMock("./dep.mjs", async () => { ++calls; console.log("factory 2"); await rest(3); return { value: "mock2" }; });
  console.log("4", now(() => require("./user.mjs")));
  await rest(10);
  console.log("5", now(() => require("./user.mjs")));
  console.log("calls", calls);
});
