// Wall and CPU time of `--lint` runs: one run, 40 runs one at a time, 40 runs four at a time.
// usage: bun /tmp/conf-wb-1b/timing.ts <binary> [envName]
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BIN = process.argv[2];
const envName = process.argv[3] ?? "none";
const WT = "/workspace/wt/conformance";
const CASES = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const base: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/root",
  BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1",
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
};
const envs: Record<string, Record<string, string>> = {
  none: base,
  harness: { ...base, ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0" },
  leak: {
    ...base,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1",
    LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${WT}/test/leaksan.supp`,
  },
  // a sweep can turn symbolization and the quarantine down: neither changes what a lint child prints when it does not crash
  lean: { ...base, ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:quarantine_size_mb=0:thread_local_quarantine_size_kb=0" },
};
const env = envs[envName];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
}
const all: string[] = [];
walk(join(CASES, "compiler"), all);
walk(join(CASES, "conformance"), all);
const step = Math.floor(all.length / 40);
const sample = Array.from({ length: 40 }, (_, i) => all[i * step]);
const bytes = sample.reduce((n, f) => n + statSync(f).size, 0);

interface Run {
  file: string;
  wallMs: number;
  cpuMs: number;
  maxRssMb: number;
  exit: number | null;
  signal: string | null;
  stderrBytes: number;
}
async function one(file: string): Promise<Run> {
  const t0 = performance.now();
  const proc = Bun.spawn({ cmd: [BIN, "--lint", file], cwd: "/tmp", env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const wallMs = performance.now() - t0;
  const usage = proc.resourceUsage();
  return {
    file,
    wallMs,
    cpuMs: Number(usage?.cpuTime.total ?? 0n) / 1000,
    maxRssMb: (usage?.maxRSS ?? 0) / 1024 / 1024,
    exit: proc.exitCode,
    signal: proc.signalCode,
    stderrBytes: stderr.length,
  };
}
async function batch(files: string[], jobs: number): Promise<{ wallMs: number; runs: Run[] }> {
  const runs: Run[] = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (next < files.length) runs.push(await one(files[next++]));
    }),
  );
  return { wallMs: performance.now() - t0, runs };
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const f = (n: number) => n.toFixed(0);

console.log(`# binary ${BIN}  env ${envName}`);
console.log(`# sample: 40 of ${all.length} .ts/.tsx case files (every ${step}th of the sorted list), ${bytes} bytes in all`);
const clean = "/tmp/conf-wb-1b/probe/clean.ts";
const singles: Run[] = [];
for (let i = 0; i < 7; i++) singles.push(await one(clean));
console.log(
  `one run (clean.ts, 7 times): wall min ${f(Math.min(...singles.map(r => r.wallMs)))} median ${f(median(singles.map(r => r.wallMs)))} max ${f(Math.max(...singles.map(r => r.wallMs)))} ms; cpu median ${f(median(singles.map(r => r.cpuMs)))} ms; maxRSS median ${f(median(singles.map(r => r.maxRssMb)))} MB`,
);
for (const jobs of [1, 4, 1, 4]) {
  const { wallMs, runs } = await batch(sample, jobs);
  const exits: Record<string, number> = {};
  for (const r of runs) exits[r.signal ?? String(r.exit)] = (exits[r.signal ?? String(r.exit)] ?? 0) + 1;
  console.log(
    `40 runs, ${jobs} at a time: wall ${f(wallMs)} ms (${f(wallMs / 40)} ms per run); per-run wall median ${f(median(runs.map(r => r.wallMs)))} max ${f(Math.max(...runs.map(r => r.wallMs)))} ms; cpu sum ${f(sum(runs.map(r => r.cpuMs)))} ms (median ${f(median(runs.map(r => r.cpuMs)))}); maxRSS max ${f(Math.max(...runs.map(r => r.maxRssMb)))} MB; exits ${JSON.stringify(exits)}`,
  );
}
