// The three step the iterator once and then refuse the number that it hands out, with the words of plain Bun.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 12
function tell(make) {
  try {
    console.log(typeof make());
  } catch (error) {
    console.log(error.name, error.message);
  }
}
tell(() => new Map(new Uint8Array([1, 2])));
tell(() => new WeakMap(new Uint8Array([1, 2])));
tell(() => new WeakSet(new Uint8Array([1, 2])));
