// A variable is stored to once, with what require() answers.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# read-ahead-of-the-store");
await import("./read-ahead-of-the-store/read-ahead-of-the-store.cjs");
await settled();
console.log("# read-by-a-function-that-is-called-ahead-of-the-store");
await import("./read-by-a-function-that-is-called-ahead-of-the-store/read-by-a-function-that-is-called-ahead-of-the-store.cjs");
await settled();
console.log("# stored-to-twice");
await import("./stored-to-twice/stored-to-twice.cjs");
await settled();
console.log("# stored-to-in-a-side-that-is-decided-when-the-program-runs");
await import("./stored-to-in-a-side-that-is-decided-when-the-program-runs/stored-to-in-a-side-that-is-decided-when-the-program-runs.cjs");
await settled();
console.log("# stored-to-by-a-function");
await import("./stored-to-by-a-function/stored-to-by-a-function.cjs");
await settled();
console.log("# the-value-of-the-store-is-used");
await import("./the-value-of-the-store-is-used/the-value-of-the-store-is-used.cjs");
await settled();
console.log("# the-variable-is-handed-on");
await import("./the-variable-is-handed-on/the-variable-is-handed-on.cjs");
await settled();
console.log("# declared-by-let");
await import("./declared-by-let/declared-by-let.cjs");
await settled();
