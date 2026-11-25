const scope = { require: name => ({ value: "the own answer for " + name, default: "the own default" }) };
console.log(require("./one.mjs").value);
with (scope) {
  console.log(require("./one.mjs").value);
}
