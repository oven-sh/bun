// Observes `bun-debug --lint` under the environment of the default check. Scratch file, not part of the repository.
// usage: bun /tmp/conf-wb/obs.ts <mode: default|none|leak> [case name ...]
import { join } from "node:path";

const bin = process.env.OBS_BIN ?? "/workspace/wt/conformance/build/debug/bun-debug";
const fx = "/tmp/conf-wb/fx";
const other = "/tmp/conf-wb/other";
const mode = process.argv[2] ?? "default";
const only = process.argv.slice(3);

function envOf(mode: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  out.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT = "1";
  out.BUN_DEBUG_QUIET_LOGS = "1";
  out.NO_COLOR = "1";
  delete out.FORCE_COLOR;
  delete out.BUN_OPTIONS;
  delete out.ASAN_OPTIONS;
  delete out.LSAN_OPTIONS;
  delete out.BUN_DESTRUCT_VM_ON_EXIT;
  if (mode === "default") out.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0";
  if (mode === "leak") {
    out.BUN_DESTRUCT_VM_ON_EXIT = "1";
    out.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1";
    out.LSAN_OPTIONS =
      "malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/conformance/test/leaksan.supp";
  }
  if (mode === "leakx") {
    out.BUN_DESTRUCT_VM_ON_EXIT = "1";
    out.BUN_JSC_validateExceptionChecks = "1";
    out.BUN_JSC_dumpSimulatedThrows = "1";
    out.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1";
    out.LSAN_OPTIONS =
      "malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/conformance/test/leaksan.supp";
  }
  return out;
}

interface Case {
  name: string;
  cwd: string;
  args: string[];
}

const cases: Case[] = [
  { name: "clean.ts", cwd: fx, args: ["clean.ts"] },
  { name: "bad.ts (const = ;)", cwd: fx, args: ["bad.ts"] },
  { name: "clean.tsx", cwd: fx, args: ["clean.tsx"] },
  { name: "bad.tsx", cwd: fx, args: ["bad.tsx"] },
  { name: "dbg.js (debugger)", cwd: fx, args: ["dbg.js"] },
  { name: "bad.d.ts (syntax error)", cwd: fx, args: ["bad.d.ts"] },
  { name: "ok.d.ts", cwd: fx, args: ["ok.d.ts"] },
  { name: "data.json", cwd: fx, args: ["data.json"] },
  { name: "missing.ts", cwd: fx, args: ["missing.ts"] },
  { name: "missing.d.ts", cwd: fx, args: ["missing.d.ts"] },
  { name: "two: bad.ts dbg.js", cwd: fx, args: ["bad.ts", "dbg.js"] },
  { name: "two: dbg.js bad.ts", cwd: fx, args: ["dbg.js", "bad.ts"] },
  { name: "two: clean.ts bad.ts", cwd: fx, args: ["clean.ts", "bad.ts"] },
  { name: "two: missing.ts bad.ts data.json", cwd: fx, args: ["missing.ts", "bad.ts", "data.json"] },
  { name: "twice: bad.ts bad.ts", cwd: fx, args: ["bad.ts", "bad.ts"] },
  { name: "crlf.ts", cwd: fx, args: ["crlf.ts"] },
  { name: "crlf.js", cwd: fx, args: ["crlf.js"] },
  { name: "cr.ts (lone CR)", cwd: fx, args: ["cr.ts"] },
  { name: "bom.ts", cwd: fx, args: ["bom.ts"] },
  { name: "bom.js", cwd: fx, args: ["bom.js"] },
  { name: "utf16.ts", cwd: fx, args: ["utf16.ts"] },
  { name: "warn.ts (return newline)", cwd: fx, args: ["warn.ts"] },
  { name: "warn.js (return newline)", cwd: fx, args: ["warn.js"] },
  { name: "warn2.js (-->)", cwd: fx, args: ["warn2.js"] },
  { name: "empty.ts", cwd: fx, args: ["empty.ts"] },
  { name: "noeol.js", cwd: fx, args: ["noeol.js"] },
  { name: "mixed.ts", cwd: fx, args: ["mixed.ts"] },
  { name: "tsonly.ts", cwd: fx, args: ["tsonly.ts"] },
  { name: "relative from other cwd: ../fx/bad.ts", cwd: other, args: ["../fx/bad.ts"] },
  { name: "relative from other cwd: ../fx/sub/inner.js", cwd: other, args: ["../fx/sub/inner.js"] },
  { name: "absolute from other cwd: bad.ts", cwd: other, args: [join(fx, "bad.ts")] },
  { name: "absolute from other cwd: sub/inner.js", cwd: other, args: [join(fx, "sub/inner.js")] },
  { name: "absolute from own cwd: bad.ts", cwd: fx, args: [join(fx, "bad.ts")] },
  { name: "absolute from a subdirectory: bad.ts", cwd: join(fx, "sub"), args: [join(fx, "bad.ts")] },
  { name: "relative ./sub/inner.ts", cwd: fx, args: ["./sub/inner.ts"] },
  { name: "no operand", cwd: fx, args: [] },
  { name: "directory operand: sub", cwd: fx, args: ["sub"] },
];

const env = envOf(mode);
const rows: unknown[] = [];
for (const c of cases) {
  if (only.length > 0 && !only.some(o => c.name.includes(o))) continue;
  const started = performance.now();
  const proc = Bun.spawn({
    cmd: [bin, "--lint", ...c.args],
    cwd: c.cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const ms = Math.round(performance.now() - started);
  const row = { name: c.name, cwd: c.cwd, args: c.args, exitCode: proc.exitCode, signal: proc.signalCode, stdout, stderr, ms };
  rows.push(row);
  console.log(
    `## ${c.name}\n   cwd=${c.cwd} args=${JSON.stringify(c.args)}\n   exit=${proc.exitCode} signal=${proc.signalCode} ms=${ms}\n   stdout=${JSON.stringify(stdout)}\n   stderr=${JSON.stringify(stderr)}`,
  );
}
await Bun.write(`/tmp/conf-wb/obs-${mode}.json`, JSON.stringify(rows, null, 1));
