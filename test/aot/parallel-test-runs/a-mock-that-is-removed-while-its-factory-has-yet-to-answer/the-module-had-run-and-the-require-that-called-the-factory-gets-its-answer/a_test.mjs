import { test, vi } from "bun:test";
test("t", async () => {
  await import("./part.mjs");
  vi.doMock("./part.mjs", () => (vi.doUnmock("./part.mjs"), { a: "mock" }));
  const first = require("./part.mjs").a;
  console.log(`SAID ${first} ${require("./part.mjs").a} ${(await import("./part.mjs")).a} ${globalThis.runsOfPart}`);
});
