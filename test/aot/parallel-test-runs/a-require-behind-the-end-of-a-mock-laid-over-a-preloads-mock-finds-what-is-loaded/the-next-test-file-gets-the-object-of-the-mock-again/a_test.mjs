import { test, vi } from "bun:test";
test("t", async () => {
  const said = [(await import("./k.mjs")).word()];
  vi.doMock("./g.cjs", () => ({ word: "own" }));
  vi.doUnmock("./g.cjs");
  said.push(require("./g.cjs") === globalThis.got);
  console.log("SAID first " + said.join(" ") + " " + (globalThis.runs ?? 0));
});
