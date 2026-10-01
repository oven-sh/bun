const bin = "/workspace/wt/conformance/build/debug/bun-debug";
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
Object.assign(env, { BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" });
delete env.LSAN_OPTIONS; delete env.BUN_DESTRUCT_VM_ON_EXIT;
for (const asan of ["allow_user_segv_handler=1:disable_coredump=0:abort_on_error=1", "allow_user_segv_handler=1:disable_coredump=0:exitcode=70", "allow_user_segv_handler=1:disable_coredump=0:symbolize=0"]) {
  env.ASAN_OPTIONS = asan;
  const started = performance.now();
  const proc = Bun.spawn({ cmd: [bin, "--lint", "manystmts.js"], cwd: "/tmp/conf-wb/fx3", env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill("SIGSEGV"), 1500);
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);
  const lines = stderr.split("\n");
  console.log(`## SIGSEGV, ASAN_OPTIONS=${asan}: exit=${proc.exitCode} signal=${proc.signalCode} wall_ms=${Math.round(performance.now() - started)} stdout_bytes=${stdout.length} stderr_lines=${lines.length - 1}`);
  for (const l of lines.slice(0, 5)) console.log(`   | ${l.slice(0, 160)}`);
}
