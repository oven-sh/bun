import { test, vi } from "bun:test";
test("t", () => {
  const held = require("./part.cjs");
  vi.doMock("./part.cjs", () => ({ a: "mocked" }));
  vi.resetModules();
  const under = require("./part.cjs").a;
  vi.doUnmock("./part.cjs");
  const behind = require("./part.cjs");
  console.log(`SAID ${under} ${behind.a} ${behind === held} ${globalThis.runsOfPart}`);
});
