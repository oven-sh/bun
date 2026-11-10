import { test, vi } from "bun:test";
test("t", async () => {
  const said = [(await import("./k.mjs")).word()];
  vi.doMock("./g.cjs", () => ({ word: "own" }));
  vi.doUnmock("./g.cjs");
  said.push(require("./g.cjs") === globalThis.got, Object.prototype.toString.call(require("./g.cjs")), (await import("./g.cjs")) === globalThis.got, require("./g.cjs") === require("./g.cjs"), "__esModule" in require("./g.cjs"));
  console.log("SAID " + said.join(" ") + " " + (globalThis.runs ?? 0));
});
