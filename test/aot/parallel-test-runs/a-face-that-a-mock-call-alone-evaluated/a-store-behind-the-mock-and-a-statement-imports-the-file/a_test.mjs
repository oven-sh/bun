import { test, vi, mock, expect } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => ({ a: "m" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  held.a = 5; const user = await import("./user.mjs"); s.push(user.read());
  s.push((await import("./p.cjs")).a, globalThis.runs);
  console.log("SAID", s.join());
});
