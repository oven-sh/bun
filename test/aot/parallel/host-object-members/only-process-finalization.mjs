// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// Collections: not forced: the callback runs only if the object is alive at exit, and nothing holds it
const held = {};
process.finalization.register(held, () => console.log("at exit"));
console.log(typeof process.finalization.unregister);
