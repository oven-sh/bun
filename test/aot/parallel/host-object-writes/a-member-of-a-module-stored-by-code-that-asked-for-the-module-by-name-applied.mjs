// Alone: the stores of other programs would be seen beside its own
// The program never hands the module's object out. Code that the build cannot follow asks for it by the module's name, and stores to it.
import holder from "node:buffer";
import { createRequire } from "node:module";
const mine = () => "mine";
function use() {
  return holder.atob("YQ==");
}
console.log(use(), typeof createRequire);
const target = Reflect.apply(JSON.parse("0", () => process.getBuiltinModule), process, ["node:buffer"]);
Object.assign(target, { atob: mine });
console.log(use(), holder.atob === mine, target === holder);
