// How a panic and an out-of-bounds of the debug build look to a parent, per environment. Scratch file.
const bin = process.env.OBS_BIN ?? "/workspace/wt/conformance/build/debug/bun-debug";
function envOf(mode: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1", BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" });
  delete env.FORCE_COLOR; delete env.BUN_OPTIONS; delete env.ASAN_OPTIONS; delete env.LSAN_OPTIONS; delete env.BUN_DESTRUCT_VM_ON_EXIT;
  if (mode === "default") env.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0";
  if (mode === "leak") {
    env.BUN_DESTRUCT_VM_ON_EXIT = "1";
    env.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1";
    env.LSAN_OPTIONS = "malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/conformance/test/leaksan.supp";
  }
  return env;
}
const scripts: Record<string, string> = {
  list: `console.log(Object.keys(require("bun:internal-for-testing").crash_handler ?? {}).join(","))`,
  panic: `require("bun:internal-for-testing").crash_handler.panic()`,
  segfault: `require("bun:internal-for-testing").crash_handler.segfault()`,
  outOfMemory: `require("bun:internal-for-testing").crash_handler.outOfMemory()`,
};
for (const [what, code] of Object.entries(scripts)) {
  for (const mode of what === "list" ? ["default"] : ["none", "default", "leak"]) {
    const started = performance.now();
    const proc = Bun.spawn({ cmd: [bin, "-e", code], cwd: "/tmp/conf-wb", env: envOf(mode), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stderr.split("\n");
    console.log(`## ${what}, env ${mode}: exit=${proc.exitCode} signal=${proc.signalCode} wall_ms=${Math.round(performance.now() - started)} stdout=${JSON.stringify(stdout.slice(0, 300))} stderr_lines=${lines.length - 1}`);
    for (const l of lines.slice(0, 8)) console.log(`   | ${l.slice(0, 200)}`);
  }
}
