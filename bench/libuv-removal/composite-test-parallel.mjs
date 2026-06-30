// composite-test-parallel.mjs
//
// CLAIM: `bun test --parallel` worker orchestration on Windows runs entirely on libuv today:
// each worker is a uv_spawn'd child (plan §2.2 "Spawn is 100% uv_spawn"), receives file
// assignments over a libuv IPC-mode pipe (uv_pipe_init(ipc=1), src/jsc/ipc.rs:878,1576-1669;
// Channel.rs adopts CRT fd 3; 16-byte frame header), and streams results/stdout back through
// uv pipes (WindowsBufferedReader/uv_read_start, plan §2.2). Phase 3 of the removal plan
// replaces this with native CreateProcessW + PROC_THREAD_ATTRIBUTE_HANDLE_LIST and native
// IOCP pipes (plan §3 Process/Pipes rows).
//
// WHAT THE NUMBERS MEAN (be honest):
//   in-process minus floor      = the runner's own per-file cost (JSC, reporter) — not uv.
//   parallel(N) minus in-process = TOTAL orchestration overhead: N worker spawns + runtime
//                                  inits + IPC dispatch/result framing + pipe reads.
//   Worker runtime init (~`bun -e 1` floor, measured here) and kernel CreateProcessW are NOT
//   uv-removable; the uv-removable slice is the pipe/IPC/spawn-bookkeeping layer on top.
//   So treat deltas as an UPPER BOUND on the Phase 3 win for this composite — and treat the
//   benchmark primarily as the Phase 3 REGRESSION GUARD (plan §3 rates pipes "Hard"; a
//   regression here is the realistic risk, and this catches it).
//
// SCENARIOS: `bun test` (in-process default), --parallel=2/4/24 on 50 trivial test files
// (fixtures/tests, local bunfig.toml so the repo-root [test] preload does not interfere).
//
// RUN (baseline):       node bench/libuv-removal/composite-test-parallel.mjs   (or bun)
// RUN (after Phase 3):  BENCH_BUN=path/to/new-bun.exe node bench/libuv-removal/composite-test-parallel.mjs
// Knobs: BENCH_RUNS (default 6), BENCH_FAST=1. Dev-box numbers are INDICATIVE.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS = join(HERE, "fixtures", "tests");
const BUN = process.env.BENCH_BUN || "bun";
const FAST = !!process.env.BENCH_FAST;
const RUNS = +(process.env.BENCH_RUNS || (FAST ? 3 : 6));
const WARMUP = FAST ? 1 : 2;

if (!existsSync(join(TESTS, "t00.test.ts"))) {
  const r = spawnSync(process.execPath, [join(HERE, "composite-gen-fixtures.mjs")], { stdio: "inherit", windowsHide: true });
  if (r.status !== 0) process.exit(1);
}

const baseEnv = { ...process.env, NO_COLOR: "1" };
delete baseEnv.UV_THREADPOOL_SIZE;
delete baseEnv.GOMAXPROCS;

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const fmt = (n, w = 8) => n.toFixed(2).padStart(w);

function timeOnce(args, { cwd = TESTS, expectTests = true } = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(BUN, args, { cwd, encoding: "utf8", windowsHide: true, env: baseEnv, stdio: ["ignore", "pipe", "pipe"] });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0) { console.error(`FAILED: bun ${args.join(" ")}\n${out}`); process.exit(1); }
  if (expectTests && !/across 50 files/.test(out)) { console.error(`unexpected test output (guard interfered?):\n${out}`); process.exit(1); }
  return ms;
}

function scenario(label, args, opts) {
  for (let i = 0; i < WARMUP; i++) timeOnce(args, opts);
  const times = [];
  for (let i = 0; i < RUNS; i++) times.push(timeOnce(args, opts));
  const med = median(times);
  console.log(`${label.padEnd(40)} ${fmt(med)} ms  (min ${fmt(Math.min(...times), 7)}, max ${fmt(Math.max(...times), 7)}, n=${RUNS})`);
  return med;
}

console.log(`# composite-test-parallel | cores=${cpus().length} | runs=${RUNS} (+${WARMUP} warmup) | ${new Date().toISOString()}`);
console.log(`# bun=${BUN} (${spawnSync(BUN, ["--version"], { encoding: "utf8", windowsHide: true }).stdout.trim()}) | 50 trivial test files, 100 tests\n`);

const floor = scenario("bun -e 1 (worker-init floor)", ["-e", "1"], { cwd: HERE, expectTests: false });
const inproc = scenario("bun test (in-process default)", ["test"]);
const p2 = scenario("bun test --parallel=2", ["test", "--parallel=2"]);
const p4 = scenario("bun test --parallel=4", ["test", "--parallel=4"]);
const p24 = scenario("bun test --parallel=24", ["test", "--parallel=24"]);

console.log(`\n## derived (orchestration overhead = parallel - in-process; upper bound on uv-removable)`);
for (const [n, v] of [[2, p2], [4, p4], [24, p24]]) {
  const overhead = v - inproc;
  console.log(`--parallel=${String(n).padEnd(2)}: total ${fmt(v, 8)} ms, overhead vs in-process ${fmt(overhead, 8)} ms  (${(overhead / n).toFixed(1)} ms/worker; worker-init floor is ${floor.toFixed(1)} ms)`);
}
console.log(`\nper-worker overhead ~= floor => spawn+IPC layer adds little beyond runtime init (uv slice is the`);
console.log(`difference); per-worker overhead >> floor => uv pipe/IPC dispatch costs are visible. Watch for`);
console.log(`REGRESSIONS here after Phase 3 (native pipes) — plan §3 rates Windows pipes the hardest port.`);
