const scope = { require: name => ({ value: "the own answer for " + name, default: "the own default" }) };
with (scope) {
  console.log(require("./one.mjs").value);
  console.log(require("./one.mjs").default);
  const { value } = require("./one.mjs");
  console.log(value, (() => require("./one.mjs").value)());
}
