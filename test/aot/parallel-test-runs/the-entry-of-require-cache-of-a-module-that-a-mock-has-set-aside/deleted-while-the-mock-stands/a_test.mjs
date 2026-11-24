import { test, vi } from "bun:test";
let calls = 0;
test("t", () => {
  const held = require("./part.cjs");
  vi.doMock("./part.cjs", () => ({ a: "mocked " + ++calls }));
  const under = require("./part.cjs").a;
  const gone = delete require.cache[require.resolve("./part.cjs")];
  const again = require("./part.cjs").a;
  vi.doUnmock("./part.cjs");
  const behind = require("./part.cjs");
  console.log(`SAID ${under} ${gone} ${again} ${behind.a} ${behind === held} ${globalThis.runsOfPart}`);
});
