// Alone: the stores of other programs would be seen beside its own
import found from "node:module";
const mine = function () {
  return "mine";
};
JSON.parse("0", () => Reflect.set)(found, "SourceMap", mine);
function use() {
  return found.SourceMap();
}
console.log(use(), found.SourceMap === mine);
