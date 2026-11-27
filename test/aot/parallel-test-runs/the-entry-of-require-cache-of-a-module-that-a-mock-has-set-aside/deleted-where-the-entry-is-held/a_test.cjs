const { test, vi } = require("bun:test");
test("t", () => {
  const key = require.resolve("./part.cjs");
  const held = require("./part.cjs");
  const entry = require.cache[key];
  vi.doMock("./part.cjs", () => ({ a: "mocked" }));
  const gone = delete require.cache[key];
  const under = require("./part.cjs").a;
  vi.doUnmock("./part.cjs");
  const behind = require("./part.cjs");
  console.log(`SAID ${gone} ${under} ${require.cache[key] === entry} ${entry.exports.a} ${behind === held} ${globalThis.runsOfPart}`);
});
