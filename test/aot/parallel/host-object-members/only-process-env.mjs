// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
process.env.MADE_HERE = "1";
console.log(process.env.MADE_HERE, "MADE_HERE" in process.env, delete process.env.MADE_HERE, process.env.MADE_HERE);
