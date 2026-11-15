// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(new Set(new Int8Array([1, 1])).size, new Set(new Float64Array([1.5, 2.5])).size, new Set(new BigInt64Array([1n, 2n, 3n])).size, new Set(new Uint8ClampedArray(4)).size);
