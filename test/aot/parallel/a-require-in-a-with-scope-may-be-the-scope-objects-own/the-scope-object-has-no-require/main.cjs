const scope = {};
with (scope) {
  console.log(require("./one.mjs").value);
  const { default: named } = require("./one.mjs");
  console.log(named, require.resolve("./one.mjs").endsWith("one.mjs"));
}
