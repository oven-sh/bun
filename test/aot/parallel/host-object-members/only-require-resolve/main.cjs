// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(require.resolve("./other.cjs").endsWith("other.cjs"), typeof require.resolve.paths);
