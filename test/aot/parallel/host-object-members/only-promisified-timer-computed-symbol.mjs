// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const custom = Symbol.for(["nodejs", "util", "promisify", "custom"].join("."));
console.log(await setImmediate[custom]("value"));
