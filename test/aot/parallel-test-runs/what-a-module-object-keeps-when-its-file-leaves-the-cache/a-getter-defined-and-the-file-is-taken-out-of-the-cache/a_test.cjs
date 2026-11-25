const { test } = require("bun:test");
test("the module object that somebody kept", () => {
  const first = require("./lib.cjs"), key = require.resolve("./lib.cjs"), kept = globalThis.kept;
  console.log("SAID", JSON.stringify(first), JSON.stringify(kept.exports), typeof Object.getOwnPropertyDescriptor(kept, "exports").get);
  delete require.cache[key];
  console.log("SAID", JSON.stringify(kept.exports), typeof Object.getOwnPropertyDescriptor(kept, "exports").get);
});
