// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const held = {};
process.finalization.register(held, () => console.log("at exit"));
console.log(typeof process.finalization.unregister);
