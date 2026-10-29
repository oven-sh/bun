// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
new console.Console(process.stdout).log({ a: [1, { b: 2 }] }, "%s", 1);
