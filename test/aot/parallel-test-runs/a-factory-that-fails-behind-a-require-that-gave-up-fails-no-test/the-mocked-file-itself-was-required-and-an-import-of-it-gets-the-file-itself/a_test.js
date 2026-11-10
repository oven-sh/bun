import { test, vi } from "bun:test";
const asked = name => { try { return String(require(name).width); } catch (error) { return "threw " + error.name; } };
let calls = 0;
test("a", async () => {
  vi.doMock("./wick.mjs", () => { calls++; return new Promise(() => {}); });
  console.log(asked("./wick.mjs"), "|", (await import("./wick.mjs")).width, "|", calls, globalThis.wicks ?? 0, "|", asked("./wick.mjs"));
});
