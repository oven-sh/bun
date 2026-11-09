import { test, vi, afterAll } from "bun:test";
const note = word => { globalThis.runs = (globalThis.runs ?? "") + word + " "; };
const asked = name => { try { const got = require(name); return String(got.seen ?? got.width); } catch (error) { return "threw " + String(error?.message).slice(0, 22); } };
test("a", async () => {
  vi.doMock("./wick.mjs", async original => { note("f<"); const own = await original(); note("f-"); return { ...own, width: "mock" }; });
  console.log(asked("./lamp.mjs"), "|", globalThis.runs);
});
