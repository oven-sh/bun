// A CommonJS facade that only a mock call has evaluated: import() and vi.importActual() return the same namespace.
import { test, vi, mock, expect } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => (console.log("SAID count factory"), { a: "m" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  held.a = 5;
  const one = await import("./p.cjs"); const two = await vi.importActual("./p.cjs");
  s.push(one.a, two.a, one === two, globalThis.runs);
  s.forEach((word, i) => console.log("SAID a " + i + " " + String(word)));
});
