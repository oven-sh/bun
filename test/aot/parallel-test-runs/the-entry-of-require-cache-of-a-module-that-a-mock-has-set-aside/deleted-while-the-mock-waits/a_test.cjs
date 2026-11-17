const { test, vi } = require("bun:test");
const hidden = [require][JSON.parse("0")];
test("t", () => {
  const held = hidden("./part.mjs");
  vi.doMock("./part.mjs", () => ({ a: "mocked" }));
  const gone = delete require.cache[require.resolve("./part.mjs")];
  const under = require("./part.mjs").a;
  vi.doUnmock("./part.mjs");
  const behind = require("./part.mjs");
  console.log(`SAID ${gone} ${under} ${behind.a} ${behind === held} ${globalThis.runsOfPart}`);
});
