// A CommonJS facade that only a mock call has evaluated: an export is stored after the mock is removed, and a dynamic import reads it.
import { test, vi, mock, expect } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => ({ a: "m" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  held.a = 5;
  s.push((await import("./p.cjs")).a, globalThis.runs);
  console.log("SAID", s.join());
});
