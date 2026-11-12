import { test, vi } from "bun:test";
test("t", async () => {
  const said = [(await import("./k.mjs")).word()];
  const before = require("./g.cjs");
  said.push(before === globalThis.got);
  vi.doMock("./g.cjs", () => ({ word: "own" }));
  vi.doUnmock("./g.cjs");
  said.push(require("./g.cjs") === globalThis.got, require("./g.cjs") === before, Object.prototype.toString.call(require("./g.cjs")));
  console.log("SAID " + said.join(" ") + " " + (globalThis.runs ?? 0));
});
