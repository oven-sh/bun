// Members of built-ins that native code answers are read and written under keys that are made at run time, and nothing names a key behind its use.
// Flags: --aot-testing=OverwriteDeadValuesAtCollections
// Env: BUN_JSC_collectContinuously=1
// Env: BUN_JSC_forceDidDeferGCWork=1
// Env: BUN_JSC_useZombieMode=1
// Env: BUN_JSC_scribbleFreeCells=1
function keyOf(parts) {
  return parts.join("");
}
let sum = 0;
for (let turn = 0; turn < 20000; turn++) {
  /(a)(b)/.exec("ab" + turn);
  sum += RegExp[keyOf(["$", "1"])].length + RegExp[keyOf(["last", "Match"])].length;
  RegExp[keyOf(["in", "put"])] = "t" + turn;
  sum += RegExp[keyOf(["in", "put"])].length;
  process.env[keyOf(["K", String(turn & 7)])] = "v" + turn;
  sum += process.env[keyOf(["K", String(turn & 7)])].length;
}
console.log(sum);
