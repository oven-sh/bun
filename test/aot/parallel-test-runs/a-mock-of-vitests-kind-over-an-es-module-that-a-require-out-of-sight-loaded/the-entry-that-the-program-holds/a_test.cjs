const { test, vi, mock } = require("bun:test");
const hidden = [require][JSON.parse("0")];
test("t", () => {
  const held = hidden("./part.mjs");
  const entry = require.cache[require.resolve("./part.mjs")];
  vi.doMock("./part.mjs", () => ({ a: "mocked" }));
  console.log("SAID under the mock", require("./part.mjs").a, entry.exports.a);
  mock.restore();
  console.log("SAID restored", require("./part.mjs").a, entry.exports.a);
  vi.doUnmock("./part.mjs");
  console.log("SAID behind its end", require("./part.mjs").a, entry.exports.a, held.a, require.cache[require.resolve("./part.mjs")] === entry);
});
