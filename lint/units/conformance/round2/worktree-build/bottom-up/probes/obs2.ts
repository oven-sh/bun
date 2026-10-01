// Observes `bun-debug --lint` on edge cases. Scratch file, not part of the repository.
// usage: bun /tmp/conf-wb/obs2.ts <mode: default|none|leak> [case name part ...]
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const bin = process.env.OBS_BIN ?? "/workspace/wt/conformance/build/debug/bun-debug";
const fx = "/tmp/conf-wb/fx2";
const mode = process.argv[2] ?? "default";
const only = process.argv.slice(3);
writeFileSync(join(fx, "h\u00e9\u{1F600}.ts"), "const = ;\n");

function envOf(mode: string, extra: Record<string, string | undefined> = {}): Record<string, string> {
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
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

interface Case {
  name: string;
  cwd?: string;
  args: string[];
  env?: Record<string, string | undefined>;
  pre?: string[];
}

const cases: Case[] = [
  { name: "warn2.ts (-->)", args: ["warn2.ts"] },
  { name: "keywarn.tsx", args: ["keywarn.tsx"] },
  { name: "keywarn.jsx", args: ["keywarn.jsx"] },
  { name: "privwrite.ts (visit-pass warning)", args: ["privwrite.ts"] },
  { name: "privwrite.js (no visit pass)", args: ["privwrite.js"] },
  { name: "jsxrt.tsx (@jsxRuntime preserve)", args: ["jsxrt.tsx"] },
  { name: "m.mts", args: ["m.mts"] },
  { name: "c.cts", args: ["c.cts"] },
  { name: "m.mjs", args: ["m.mjs"] },
  { name: "c.cjs", args: ["c.cjs"] },
  { name: "j.jsx", args: ["j.jsx"] },
  { name: "with space.ts", args: ["with space.ts"] },
  { name: "paren(1,2).ts", args: ["paren(1,2).ts"] },
  { name: "unicode name", args: ["h\u00e9\u{1F600}.ts"] },
  { name: "./-dash.ts", args: ["./-dash.ts"] },
  { name: "-dash.ts as first operand", args: ["-dash.ts"] },
  { name: "-- -dash.ts", args: ["--", "-dash.ts"] },
  { name: "warn2.ts -dash.ts (dash after first)", args: ["warn2.ts", "-dash.ts"] },
  { name: "dir.ts (a directory)", args: ["dir.ts"] },
  { name: "symlinked cwd: in.ts", cwd: join(fx, "link"), args: ["in.ts"] },
  { name: "symlinked cwd: absolute via link", cwd: join(fx, "link"), args: [join(fx, "link/in.ts")] },
  { name: "symlinked cwd: absolute via real", cwd: join(fx, "link"), args: [join(fx, "real/in.ts")] },
  { name: "operand through symlink: link/in.ts", args: ["link/in.ts"] },
  { name: "tsinjs.js (type annotation in .js)", args: ["tsinjs.js"] },
  { name: "deco.ts", args: ["deco.ts"] },
  { name: "nul.ts", args: ["nul.ts"] },
  { name: "badutf8.ts", args: ["badutf8.ts"] },
  { name: "constassign.js", args: ["constassign.js"] },
  { name: "constassign.ts", args: ["constassign.ts"] },
  { name: "redecl.ts", args: ["redecl.ts"] },
  { name: "redecl.js", args: ["redecl.js"] },
  { name: "imp.ts (import of a missing module)", args: ["imp.ts"] },
  { name: "rules.js", args: ["rules.js"] },
  { name: "rules.ts (rules do not run on TypeScript)", args: ["rules.ts"] },
  { name: "x.d.js.ts", args: ["x.d.js.ts"] },
  { name: "deep.ts (200000 parentheses)", args: ["deep.ts"] },
  { name: "deep.js (200000 parentheses)", args: ["deep.js"] },
  { name: "deep-arr.js (200000 brackets)", args: ["deep-arr.js"] },
  { name: "deep-obj.ts (100000 objects)", args: ["deep-obj.ts"] },
  { name: "deep-type.ts (100000 type arguments)", args: ["deep-type.ts"] },
  { name: "big.ts (20000 functions, 1.5 MB)", args: ["big.ts"] },
  { name: "big.js (20000 functions, 1.0 MB)", args: ["big.js"] },
  { name: "gate unset", args: ["warn2.ts"], env: { BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: undefined } },
  { name: "gate =0", args: ["warn2.ts"], env: { BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "0" } },
  { name: "FORCE_COLOR=1 on a pipe", args: ["x.d.js.ts"], env: { FORCE_COLOR: "1", NO_COLOR: undefined } },
  { name: "BUN_DEBUG_QUIET_LOGS unset", args: ["x.d.js.ts"], env: { BUN_DEBUG_QUIET_LOGS: undefined } },
  { name: "bun run --lint", pre: ["run"], args: ["x.d.js.ts"] },
  { name: "--lint=value", pre: [], args: [], env: {}, },
];

const rows: unknown[] = [];
for (const c of cases) {
  if (only.length > 0 && !only.some(o => c.name.includes(o))) continue;
  const started = performance.now();
  let cmd = [bin, ...(c.pre ?? []), "--lint", ...c.args];
  if (c.name === "--lint=value") cmd = [bin, "--lint=value", "warn2.ts"];
  const proc = Bun.spawn({
    cmd,
    cwd: c.cwd ?? fx,
    env: envOf(mode, c.env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const ms = Math.round(performance.now() - started);
  const usage = proc.resourceUsage();
  const cpuMs = usage ? Math.round(Number(usage.cpuTime.total) / 1000) : -1;
  const maxRssMb = usage ? Math.round(Number(usage.maxRSS) / 1024 / 1024) : -1;
  const clip = (s: string) => (s.length > 1500 ? s.slice(0, 1500) + `... [${s.length} chars]` : s);
  rows.push({ name: c.name, cmd, exitCode: proc.exitCode, signal: proc.signalCode, stdout, stderr, ms, cpuMs, maxRssMb });
  console.log(
    `## ${c.name}\n   cwd=${c.cwd ?? fx} cmd=${JSON.stringify(cmd.slice(1))}\n   exit=${proc.exitCode} signal=${proc.signalCode} wall_ms=${ms} cpu_ms=${cpuMs} maxrss_mb=${maxRssMb}\n   stdout=${JSON.stringify(clip(stdout))}\n   stderr=${JSON.stringify(clip(stderr))}`,
  );
}
await Bun.write(`/tmp/conf-wb/obs2-${mode}.json`, JSON.stringify(rows, null, 1));
