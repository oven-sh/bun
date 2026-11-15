const scope = { require: name => ({ value: "the own answer for " + name, default: "the own default" }) };
console.log(require("./one.mjs").value);
for (let turn = 0; turn < 2; turn++) {
  with (scope) {
    console.log(require("./one.mjs").value);
  }
  delete scope.require;
}
