import { test, vi, mock, expect } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => ({ a: "m" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  const user = await import("./user.mjs"); s.push(user.read()); held.b = 7;
  vi.doMock("./p.cjs", () => ({ a: "m2" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  const again = await import("./p.cjs"); s.push(Object.keys(again).sort().join("+"), again.b);
  s.push((await import("./p.cjs")).a, globalThis.runs);
  console.log("SAID", s.join());
});
