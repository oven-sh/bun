import { test, vi } from "bun:test";
let held;
test("first", () => {
  held = require("./part.mjs");
  vi.doMock("./part.mjs", () => ({ a: "mocked" }));
});
test("second", () => {
  const under = require("./part.mjs").a;
  vi.doUnmock("./part.mjs");
  const behind = require("./part.mjs");
  console.log(`SAID ${under} ${behind.a} ${behind === held} ${globalThis.runsOfPart}`);
});
