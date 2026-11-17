import { test, vi } from "bun:test";
test("t", () => {
  const before = require("./part.cjs").a;
  vi.doMock("./part.cjs", () => (vi.doUnmock("./part.cjs"), { a: "mock" }));
  const first = require("./part.cjs").a;
  console.log(`SAID ${before} ${first} ${require("./part.cjs").a} ${globalThis.runsOfPart}`);
});
