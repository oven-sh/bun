import { test, vi } from "bun:test";
const asked = name => { try { return String(require(name).seen); } catch (error) { return "threw " + error.name; } };
test("a", () => {
  vi.doMock("./wick.mjs", () => new Promise(() => {}));
  console.log(asked("./lamp.mjs"), "|", asked("./shade.cjs"), "|", globalThis.wicks ?? 0);
});
