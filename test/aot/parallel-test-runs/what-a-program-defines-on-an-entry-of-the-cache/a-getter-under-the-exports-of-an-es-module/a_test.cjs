const { test } = require("bun:test");
for (const name in require.cache) void name;
test("require() calls the getter that lies under `exports` of the entry", () => {
  const key = require.resolve("./esm.mjs");
  console.log("SAID", require("./esm.mjs").value);
  let calls = 0;
  Object.defineProperty(require.cache[key], "exports", { get() { calls++; return "got"; }, configurable: true });
  const again = require("./esm.mjs");
  console.log("SAID", typeof again, again === "got", Object.prototype.toString.call(again), calls);
  Object.defineProperty(require.cache[key], "exports", { value: "defined", configurable: true });
  console.log("SAID", require("./esm.mjs"));
});
