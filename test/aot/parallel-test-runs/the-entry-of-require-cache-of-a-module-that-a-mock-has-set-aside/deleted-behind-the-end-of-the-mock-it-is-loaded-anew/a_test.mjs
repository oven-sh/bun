import { test, vi } from "bun:test";
test("t", () => {
  const held = require("./part.mjs");
  vi.doMock("./part.mjs", () => ({ a: "mocked" }));
  const under = require("./part.mjs").a;
  vi.doUnmock("./part.mjs");
  const gone = delete require.cache[require.resolve("./part.mjs")];
  const behind = require("./part.mjs");
  console.log(`SAID ${under} ${gone} ${behind.a} ${behind === held} ${globalThis.runsOfPart}`);
});
