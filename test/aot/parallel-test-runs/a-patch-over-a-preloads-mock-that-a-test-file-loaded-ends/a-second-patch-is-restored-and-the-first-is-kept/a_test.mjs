import { mock, test, vi } from "bun:test";
test("a2", async () => {
  const said = [];
  said.push(require("./g.cjs").word);
  const h = await import("./h.mjs");
  vi.doMock("./g.cjs", () => ({ word: "one" }));
  vi.doUnmock("./g.cjs");
  mock.module("./g.cjs", () => ({ word: "patch" }));
  vi.doUnmock("./g.cjs");
  said.push(h.read());
  const n = await import("./n.mjs");
  said.push(n.read());
  mock.module("./g.cjs", () => ({ word: "two" }));
  vi.doUnmock("./g.cjs");
  said.push(h.read(), n.read());
  console.log("SAID", said.join(" | "), globalThis.runs ?? 0);
});
