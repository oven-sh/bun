// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function* numbers() {
  yield 1;
  yield 2;
}
console.log(
  [...new Set([1])].length,
  [...new Map([[1, 2]])].length,
  [..."ab"].length,
  [...numbers()].length,
  Math.max(...numbers()),
);
