const { test } = require("bun:test");
test("whoever requires the file next gets nothing once `exports` of its entry is deleted", () => {
  const { seen } = require("./user.cjs");
  console.log("SAID", seen());
  console.log("SAID", delete require.cache[require.resolve("./by-the-operator.cjs")].exports);
  console.log("SAID", Reflect.deleteProperty(require.cache[require.resolve("./by-reflect.cjs")], "exports"));
  const entry = require.cache[require.resolve("./stored-behind.cjs")];
  console.log("SAID", delete entry.exports, "exports" in entry);
  entry.exports = { a: "stored" };
  console.log("SAID", require("./by-the-operator.cjs")?.a, require("./by-reflect.cjs")?.a, require("./stored-behind.cjs")?.a);
  const made = name => require("./" + JSON.parse(`"${name}.cjs"`))?.a;
  console.log("SAID", made("by-the-operator"), made("by-reflect"), made("stored-behind"));
  console.log("SAID", seen());
});
