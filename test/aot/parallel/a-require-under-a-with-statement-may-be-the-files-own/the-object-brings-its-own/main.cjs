const scope = { require: name => ({ value: "the own answer for " + name }) };
with (scope) {
  console.log("SAID", require("./one.cjs").value);
}
console.log("SAID", require("./two.cjs").value);
