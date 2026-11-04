// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(
  process.allowedNodeEnvironmentFlags.has("--max-old-space-size"),
  process.allowedNodeEnvironmentFlags.has("--nothing"),
);
