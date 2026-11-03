// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import "./first.mjs";
var isBun = typeof Bun === "object";
let alsoBun = typeof Bun === "object";
export function which() {
  return isBun ? "bun" : "not yet";
}
export function whichOrThrows() {
  try {
    return alsoBun ? "bun" : "other";
  } catch (error) {
    return error.name;
  }
}
console.log(which(), whichOrThrows());
