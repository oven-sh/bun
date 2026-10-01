// How a lint child that dies of a signal looks to its parent, per environment. Scratch file.
const bin = process.env.OBS_BIN ?? "/workspace/wt/conformance/build/debug/bun-debug";
const modes = ["none", "default", "leak"] as const;
function envOf(mode: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" });
  delete env.FORCE_COLOR; delete env.BUN_OPTIONS; delete env.ASAN_OPTIONS; delete env.LSAN_OPTIONS; delete env.BUN_DESTRUCT_VM_ON_EXIT;
  if (mode === "default") env.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0";
  if (mode === "leak") {
    env.BUN_DESTRUCT_VM_ON_EXIT = "1";
    env.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1";
    env.LSAN_OPTIONS = "malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/conformance/test/leaksan.supp";
  }
  return env;
}
for (const sig of ["SIGSEGV", "SIGABRT", "SIGKILL", "SIGTERM"] as const) {
  for (const mode of modes) {
    const started = performance.now();
    const proc = Bun.spawn({ cmd: [bin, "--lint", "manystmts.js"], cwd: "/tmp/conf-wb/fx3", env: envOf(mode), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(sig), 1500);
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    clearTimeout(timer);
    const lines = stderr.split("\n");
    console.log(`## ${sig} after 1.5 s, env ${mode}: exit=${proc.exitCode} signal=${proc.signalCode} wall_ms=${Math.round(performance.now() - started)} stdout_bytes=${stdout.length} stderr_lines=${lines.length - 1}`);
    for (const l of lines.slice(0, 14)) console.log(`   | ${l.slice(0, 220)}`);
  }
}
