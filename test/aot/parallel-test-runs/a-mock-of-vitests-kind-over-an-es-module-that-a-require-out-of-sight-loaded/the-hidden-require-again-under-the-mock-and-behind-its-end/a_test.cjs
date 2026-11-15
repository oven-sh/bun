const { test, vi, mock } = require("bun:test");
const hidden = [require][JSON.parse("0")];
const cached = () => { const entry = require.cache[require.resolve("./part.mjs")]; return entry ? String(entry.exports?.a) : "no entry"; };
test("t", async () => {
  const held = hidden("./part.mjs");
  console.log("SAID first", held.a, cached());
  vi.doMock("./part.mjs", () => ({ a: "mocked" }));
  console.log("SAID under", hidden("./part.mjs").a, require("./part.mjs").a, (await import("./part.mjs")).a, cached());
  vi.doUnmock("./part.mjs");
  console.log("SAID behind", hidden("./part.mjs").a, require("./part.mjs").a, (await import("./part.mjs")).a, cached());
  console.log("SAID held", held.a);
});
