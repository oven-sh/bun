import { test, vi, mock, expect } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => ({ a: "m" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  const user = await import("./user.mjs"); s.push(user.read()); held.a = 5;
  vi.doMock("./p.cjs", () => ({ a: "m2" })); require("./p.cjs"); vi.doUnmock("./p.cjs");
  const other = await import("./other.mjs"); s.push(user.read(), other.read());
  s.push((await import("./p.cjs")).a, globalThis.runs);
  console.log("SAID", s.join());
});
