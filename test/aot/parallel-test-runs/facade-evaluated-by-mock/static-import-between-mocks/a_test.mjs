// A CommonJS facade that only a mock call has evaluated: a static import is linked between two mocks.
import { test, vi, mock, expect } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => ({ a: "m" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  const user = await import("./user.mjs"); s.push(user.read()); held.a = 5; s.push(user.read());
  vi.doMock("./p.cjs", () => ({ a: "m2" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  s.push(user.read());
  s.push((await import("./p.cjs")).a, globalThis.runs);
  console.log("SAID", s.join());
});
