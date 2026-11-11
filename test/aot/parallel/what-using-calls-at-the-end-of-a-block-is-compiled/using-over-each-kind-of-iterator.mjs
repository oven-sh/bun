// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function* made() {
  try {
    yield 1;
  } finally {
    console.log("closed");
  }
}
{
  using ofMap = new Map([[1, 2]]).keys();
  using ofSet = new Set([3]).values();
  using ofText = "ab"[Symbol.iterator]();
  using ofBytes = new Uint8Array([4]).values();
  using ofMatches = "a1".matchAll(/[0-9]/g);
  using ofGenerator = made();
  using ofHelper = [5].values().map(count => count + 1);
  console.log(ofMap.next().value, ofSet.next().value, ofText.next().value, ofBytes.next().value, ofMatches.next().value[0], ofGenerator.next().value, ofHelper.next().value);
}
console.log("after");
