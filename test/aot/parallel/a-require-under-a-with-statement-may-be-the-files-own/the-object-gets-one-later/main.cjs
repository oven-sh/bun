const scope = {};
const said = [];
for (let round = 0; round < 2; ++round) {
  with (scope) {
    said.push(require("./one.cjs").value);
  }
  scope.require = name => ({ value: "another for " + name });
}
console.log("SAID", said.join());
