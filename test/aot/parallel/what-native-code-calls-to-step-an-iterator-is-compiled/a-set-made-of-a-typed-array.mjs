// new Set() steps the iterator of a typed array by next() of array iterators, which is text of the library. Nothing here names next, and the typed array goes nowhere else.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: ImageFunctionsEmitted <= 8
console.log(new Set(new Uint8Array([1, 2, 2])).size);
