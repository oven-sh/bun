// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
process.loadEnvFile("some.env");
console.log(process.env.FROM_THE_FILE);
