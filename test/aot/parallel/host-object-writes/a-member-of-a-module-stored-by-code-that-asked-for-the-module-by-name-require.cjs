// Alone: the stores of other programs would be seen beside its own
// The program never hands the module's object out. Code that the build cannot follow asks for it by the module's name, and stores to it.
const holder = require("node:buffer");
const mine = () => "mine";
function use() {
  return holder.btoa("a");
}
console.log(use());
const target = JSON.parse("0", () => require)("node:buffer");
target.btoa = mine;
console.log(use(), holder.btoa === mine, target === holder);
