import { test, vi, afterAll } from "bun:test";
const note = word => { globalThis.runs = (globalThis.runs ?? "") + word + " "; };
const asked = name => { try { const got = require(name); return String(got.seen ?? got.width); } catch (error) { return "threw " + String(error?.message).slice(0, 22); } };
afterAll(() => console.log("bodies", globalThis.bodies));
test("a", async () => {
  const takes = tag => vi.doMock("./wick.mjs", async original => { note(tag); return { ...(await original()), tag }; });
  takes("f");
  console.log(await import("./lamp.mjs").then(it => it.seen, error => error.message));
  vi.doUnmock("./wick.mjs");
  takes("g");
  console.log(asked("./lamp.mjs"));
  console.log(asked("./lamp.mjs"), globalThis.runs);
});
