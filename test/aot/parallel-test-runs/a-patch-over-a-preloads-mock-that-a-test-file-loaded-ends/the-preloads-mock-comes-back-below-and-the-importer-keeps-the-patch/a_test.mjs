import { mock, test, vi } from "bun:test";
test("the end restores the require map and leaves the importer's binding", async () => {
  const said = [];
  const h = await import("./h.mjs");
  said.push(h.read());
  vi.doMock("./g.cjs", () => ({ word: "own" }));
  vi.doUnmock("./g.cjs");
  mock.module("./g.cjs", () => ({ word: "patch" }));
  said.push(h.read());
  vi.doUnmock("./g.cjs");
  said.push(h.read());
  said.push((await import("./g.cjs")).word);
  said.push(require("./g.cjs").word);
  console.log("SAID", said.join(" | "), globalThis.runs ?? 0);
});
