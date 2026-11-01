// Alone: the stores of other programs would be seen beside its own
// The program never hands the module's object out. Code that the build cannot follow asks for it by the module's name, and stores to it.
import holder from "node:buffer";
import { createRequire } from "node:module";
const mine = () => "mine";
function use() {
  return holder.atob("YQ==");
}
console.log(use(), typeof createRequire);
const target = JSON.parse("0", () => createRequire)(import.meta.url)("node:buffer");
target[JSON.parse('"atob"')] = mine;
console.log(use(), holder.atob === mine, target === holder);
