const { test } = require("bun:test");
for (const name in require.cache) void name;
test("require() answers what is left under `exports` of the entry: nothing", () => {
  const first = require("./esm.mjs");
  const entry = require.cache[require.resolve("./esm.mjs")];
  console.log("SAID", first.value, entry.exports === first, delete entry.exports);
  const again = require("./esm.mjs");
  console.log("SAID", again === first, again === undefined, "exports" in entry);
  entry.exports = "stored";
  console.log("SAID", require("./esm.mjs"));
});
