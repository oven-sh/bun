import { test, vi, afterAll } from "bun:test";
const note = word => { globalThis.runs = (globalThis.runs ?? "") + word + " "; };
const asked = name => { try { const got = require(name); return String(got.seen ?? got.width); } catch (error) { return "threw " + String(error?.message).slice(0, 22); } };
const later = () => new Promise(resolve => setTimeout(resolve, 60));
test("a", async () => {
  vi.doMock("./wick.mjs", original => { note("f<"); original().catch(error => note("caught:" + error.message)); note("f-"); return { width: "mock" }; });
  console.log(asked("./lamp.mjs"), "|", globalThis.runs);
  await later();
  console.log("later", globalThis.runs);
});
