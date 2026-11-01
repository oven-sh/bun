// Alone: the stores of other programs would be seen beside its own
const buffer = require("node:buffer");
const mine = () => "mine";
JSON.parse("0", () => Reflect.set)(buffer, "btoa", mine);
function use() {
  return buffer.btoa("a");
}
console.log(use(), buffer.btoa === mine);
