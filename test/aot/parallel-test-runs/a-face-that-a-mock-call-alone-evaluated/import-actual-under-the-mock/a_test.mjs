import { test, vi, mock, expect } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => (console.log("SAID count factory"), { a: "m" })); require("./p.cjs"); const actual = await vi.importActual("./p.cjs"); vi.doUnmock("./p.cjs");
  held.a = 5;
  s.push((await import("./p.cjs")).a, globalThis.runs);
  s.push(actual.a);
  s.forEach((word, i) => console.log("SAID a " + i + " " + String(word)));
});
