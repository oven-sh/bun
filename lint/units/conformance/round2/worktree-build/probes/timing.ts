// Times `<bin> --lint <case file>` on 40 case files of the corpus, one at a time and four at a time. Scratch file.
// usage: bun /tmp/conf-wb/timing.ts <bin> <mode: default|none|leak> <rounds>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const bin = process.argv[2] ?? "/workspace/wt/conformance/build/debug/bun-debug";
const mode = process.argv[3] ?? "default";
const rounds = Number(process.argv[4] ?? 2);
const cases = "/tmp/conf-wb/tree/conformance/corpus/cases";

function walk(dir: string, out: string[]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
}
const all: string[] = [];
walk(cases, all);
all.sort();
const step = Math.floor(all.length / 40);
const sample = Array.from({ length: 40 }, (_, k) => all[k * step]);

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT = "1";
env.BUN_DEBUG_QUIET_LOGS = "1";
env.NO_COLOR = "1";
delete env.FORCE_COLOR;
delete env.BUN_OPTIONS;
delete env.ASAN_OPTIONS;
delete env.LSAN_OPTIONS;
delete env.BUN_DESTRUCT_VM_ON_EXIT;
if (mode === "default") env.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0";
if (mode === "leak") {
  env.BUN_DESTRUCT_VM_ON_EXIT = "1";
  env.ASAN_OPTIONS = "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1";
  env.LSAN_OPTIONS = "malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/conformance/test/leaksan.supp";
}

interface One {
  file: string;
  wall: number;
  cpu: number;
  rss: number;
  exit: number | null;
  signal: string | null;
  lines: number;
}

async function one(file: string): Promise<One> {
  const started = performance.now();
  const proc = Bun.spawn({ cmd: [bin, "--lint", file], cwd: "/tmp/conf-wb", env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const wall = performance.now() - started;
  const u = proc.resourceUsage();
  return {
    file,
    wall,
    cpu: u ? Number(u.cpuTime.total) / 1000 : -1,
    rss: u ? Number(u.maxRSS) / 1024 / 1024 : -1,
    exit: proc.exitCode,
    signal: proc.signalCode as string | null,
    lines: stderr.split("\n").length - 1,
  };
}

async function batch(width: number): Promise<{ total: number; rows: One[] }> {
  const rows: One[] = new Array(sample.length);
  let next = 0;
  const started = performance.now();
  const worker = async () => {
    for (let i = next++; i < sample.length; i = next++) rows[i] = await one(sample[i]);
  };
  await Promise.all(Array.from({ length: width }, worker));
  return { total: performance.now() - started, rows };
}

const q = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const load = () => readFileSync("/proc/loadavg", "utf8").trim();
const bytes = sample.reduce((s, f) => s + readFileSync(f).length, 0);
console.log(`bin ${bin}\nmode ${mode}; ${sample.length} case files of ${all.length}, ${bytes} bytes in all`);
for (let r = 0; r < rounds; r++) {
  for (const width of [1, 4]) {
    const before = load();
    const { total, rows } = await batch(width);
    const walls = rows.map(x => x.wall);
    const cpus = rows.map(x => x.cpu);
    const exits = new Map<string, number>();
    for (const x of rows) exits.set(`${x.exit}/${x.signal}`, (exits.get(`${x.exit}/${x.signal}`) ?? 0) + 1);
    console.log(
      `round ${r + 1} width ${width}: total wall ${(total / 1000).toFixed(2)} s; per run wall min ${q(walls, 0).toFixed(0)} median ${q(walls, 0.5).toFixed(0)} p90 ${q(walls, 0.9).toFixed(0)} max ${q(walls, 1).toFixed(0)} ms; cpu min ${q(cpus, 0).toFixed(0)} median ${q(cpus, 0.5).toFixed(0)} max ${q(cpus, 1).toFixed(0)} ms, cpu sum ${(cpus.reduce((a, b) => a + b, 0) / 1000).toFixed(2)} s; maxrss median ${q(rows.map(x => x.rss), 0.5).toFixed(0)} MB; exits ${JSON.stringify([...exits])}; loadavg before: ${before}`,
    );
  }
}
