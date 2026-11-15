const { test } = require("bun:test");
test("the module object that somebody kept", () => {
  const first = require("./lib.cjs"), key = require.resolve("./lib.cjs"), kept = globalThis.kept;
  console.log("SAID", typeof first, "exports" in kept, typeof kept.exports);
  delete require.cache[key];
  console.log("SAID", "exports" in kept, typeof kept.exports);
  const second = require("./lib.cjs");
  console.log("SAID", typeof second, globalThis.kept === kept, "exports" in kept, typeof kept.exports);
});
