import { mock, test, vi } from "bun:test";
test("what was linked under the preload's mock keeps the patch behind its end", async () => {
  const said = [];
  const h = await import("./h.mjs");
  said.push(h.read());
  mock.module("./g.cjs", () => ({ word: "patch" }));
  said.push(h.read());
  vi.doUnmock("./g.cjs");
  said.push(h.read());
  said.push((await import("./g.cjs")).word);
  said.push(h.read());
  console.log("SAID", said.join(" | "), globalThis.runs ?? 0);
});
