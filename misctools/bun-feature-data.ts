let internal;
try {
  internal = require("bun:internal-for-testing");
} catch {
  const result = Bun.spawnSync({
    cmd: [process.execPath, import.meta.file],
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
      BUN_GARBAGE_COLLECTOR_LEVEL: "0",
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    },
  });
  process.exit(result.exitCode);
}
if (internal) {
  console.log(JSON.stringify(internal.crash_handler.getFeatureData(), null, 2));
}
