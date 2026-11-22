// A CommonJS facade that only a mock call has evaluated: an export is added after the mock is removed, and the module is imported.
import { test, vi, mock, expect } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => ({ a: "m" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  held.b = 7; const again = await import("./p.cjs"); s.push(Object.keys(again).sort().join("+"), again.b);
  s.push((await import("./p.cjs")).a, globalThis.runs);
  console.log("SAID", s.join());
});
