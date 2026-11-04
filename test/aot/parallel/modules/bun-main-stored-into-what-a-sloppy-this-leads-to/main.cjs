// No expression of the program stands for `Bun` where it is stored into, so the comparisons are decided in the code. `bun run` takes the store and an executable may refuse it.
// Either way all that names the main module says the same afterwards, and a refusal is caught where it is thrown.
const other = require("./other.cjs");
const realm = (function () {
  return this;
})();
let caught = "nothing";
try {
  realm["B" + "un"].main = other.path;
} catch (error) {
  caught = error.name;
}
const main = require.main;
console.log(caught === "nothing" || caught === "TypeError");
console.log(main.filename === Bun.main, process.mainModule === main, (require.main === module) === (main === module), other.isMain() === (main.filename === other.path));
