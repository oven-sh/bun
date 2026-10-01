import { readdirSync } from "node:fs";
const bin = process.env.OBS_BIN ?? "/workspace/wt/conformance/build/debug/bun-debug";
const dir = process.argv[2] ?? "/tmp/conf-wb/fx3";
const mode = process.argv[3] ?? "default";
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
const rows: unknown[] = [];
for (const name of readdirSync(dir).sort()) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const proc = Bun.spawn({ cmd: [bin, "--lint", name], cwd: dir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", signal: controller.signal, killSignal: "SIGKILL" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);
  const ms = Math.round(performance.now() - started);
  const u = proc.resourceUsage();
  const lines = stderr.split("\n");
  const clip = (s: string) => (s.length > 300 ? s.slice(0, 300) + `... [${s.length} chars]` : s);
  rows.push({ name, exitCode: proc.exitCode, signal: proc.signalCode, stdout, stderr: stderr.slice(0, 20000), ms });
  console.log(`## ${name}: exit=${proc.exitCode} signal=${proc.signalCode} wall_ms=${ms} cpu_ms=${u ? Math.round(Number(u.cpuTime.total) / 1000) : -1} maxrss_mb=${u ? Math.round(Number(u.maxRSS) / 1048576) : -1} stdout_bytes=${stdout.length} stderr_lines=${lines.length - 1}\n   first=${JSON.stringify(clip(lines[0] ?? ""))}${lines.length > 2 ? `\n   second=${JSON.stringify(clip(lines[1]))}\n   last=${JSON.stringify(clip(lines[lines.length - 2]))}` : ""}`);
}
await Bun.write(`/tmp/conf-wb/obs3-${mode}.json`, JSON.stringify(rows, null, 1));
