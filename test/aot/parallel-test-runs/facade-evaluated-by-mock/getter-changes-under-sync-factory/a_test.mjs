// A CommonJS facade that only a mock call has evaluated: the value of a getter changes under vi.doMock(), and the module is imported.
import { test, vi, jest, mock } from "bun:test";
test("t", async () => {
  const held = require("./p.cjs"); const s = [];
  vi.doMock("./p.cjs", () => ({ a: "m", default: { a: "md" } }));  held.a = 5; vi.doUnmock("./p.cjs");
  
  s.push((await import("./p.cjs")).a);
  held.a = 9; s.push((await import("./p.cjs")).a);
  s.push((await import("./p.cjs")).a, globalThis.runs);
  console.log("SAID", s.join());
});
