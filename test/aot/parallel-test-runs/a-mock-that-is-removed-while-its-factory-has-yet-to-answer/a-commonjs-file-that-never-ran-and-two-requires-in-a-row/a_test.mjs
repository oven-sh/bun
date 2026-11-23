import { test, vi } from "bun:test";
test("t", () => {
  vi.doMock("./part.cjs", () => (vi.doUnmock("./part.cjs"), { a: "mock" }));
  const first = require("./part.cjs").a;
  console.log(`SAID ${first} ${require("./part.cjs").a}`);
});
