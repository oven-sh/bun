const { test } = require("bun:test");
test("whoever requires the file next gets what the program defined under `exports` of its entry", () => {
  const { seen } = require("./user.cjs");
  console.log("SAID", seen());
  const fake = { a: "fake" };
  let asked = 0;
  Object.defineProperty(require.cache[require.resolve("./by-a-value.cjs")], "exports", { value: fake });
  const entry = require.cache[require.resolve("./by-a-getter.cjs")];
  Object.defineProperty(entry, "exports", { get: () => ({ a: "fake " + ++asked }) });
  Object.defineProperties(require.cache[require.resolve("./by-several-definitions.cjs")], { exports: { value: fake } });
  console.log("SAID", require("./by-a-value.cjs")?.a, require("./by-a-getter.cjs")?.a, require("./by-several-definitions.cjs")?.a);
  const made = name => require("./" + JSON.parse(`"${name}.cjs"`))?.a;
  console.log("SAID", made("by-a-value"), made("by-a-getter"), made("by-several-definitions"));
  console.log("SAID", seen());
});
