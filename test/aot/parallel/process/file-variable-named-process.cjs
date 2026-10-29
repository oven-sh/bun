// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
var process = { versions: { node: "0" } };
function which() {
  return typeof process !== "undefined" && "bun" in process.versions ? "bun" : "other";
}
console.log(which(), process.isBun, process.versions.bun, globalThis.process.isBun);
