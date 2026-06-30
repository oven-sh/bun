// spawn-async-throughput.mjs — bun AND node. Async spawn throughput & latency
// (the test-runner / lint-staged / turbo shape: many short children, modest fan-out).
//
// CLAIM UNDER TEST
//   "Removing libuv speeds up parallel process spawning on Windows."
//   Honest expectation, measured TODAY: mostly NO. The throughput ceiling is set
//   by CreateProcessW itself (~1.3-1.6 ms serialized on the spawning thread on
//   this box => ~600 spawns/s), which uv_spawn AND the native design
//   (plan Phase 3.2) both call synchronously on the JS thread — Bun.spawn returns
//   .pid synchronously, so creation cannot move off-thread. What CAN move:
//     * per-spawn libuv layer work serialized on the JS thread (pipe pairs,
//       3x NUL opens, env block rebuild — see spawn-sync-overhead.mjs), a few
//       percent of the serialized portion;
//     * exit-path dispatch: RegisterWaitForSingleObject -> wait thread ->
//       PostQueuedCompletionStatus -> uv_run -> exit_cb (libuv process.c:1135,
//       async.c:96-99) becomes RegisterWait -> native IOCP post -> loop —
//       same shape, expect ~0.
//   So treat this as the REGRESSION GUARDRAIL for the async path + the marketing
//   table vs node (bun ~1.5x node at fan-out today on this box). A large bun
//   sequential-async-vs-sync gap appearing here would flag a loop-integration
//   problem (e.g. Windows tick timeout handling, plan §1 "Windows finally honors
//   poll timeouts") — today the gap is ~0.1-0.5 ms and unstable (machine noise).
//
//   NOTE: UV_THREADPOOL_SIZE does NOT matter for this benchmark. On Windows the
//   spawn path never touches the uv threadpool: uv__stdio_create runs inline on
//   the calling thread, pipe I/O is overlapped IOCP on the loop, and exit watch
//   uses the Win32 native thread-pool wait (process.c:1135). Verified empirically
//   on this box: UV_THREADPOOL_SIZE=24 lands inside the unset-run spread band.
//
//   MEASURED TODAY (bun 1.4.0 / node 25.8.1, null child): async−sync ≈ +0.0..0.5
//   ms (no loop-integration penalty); ceiling ~400-520 spawns/s at conc>=8 in
//   BOTH runtimes (≈2-2.5 ms serialized per spawn); pipe ≈ ignore within spread.
//
// METHOD
//   N children per (mode x concurrency) cell, total wall time -> spawns/s;
//   3 repeats, median reported with min..max. Sequential async latency is also
//   compared against spawnSync in the same run. INDICATIVE numbers; dev machine.
//
// RUN
//   bun  bench/libuv-removal/spawn-async-throughput.mjs   (before/after migration)
//   node bench/libuv-removal/spawn-async-throughput.mjs   (reference)

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const IS_BUN = typeof Bun !== "undefined";
if (process.platform !== "win32") {
  console.error("Windows-only benchmark.");
  process.exit(1);
}

const DIR = fileURLToPath(new URL(".", import.meta.url));
const CHILD = DIR + "nullchild.exe";
if (!existsSync(CHILD)) {
  let built = false;
  for (const cc of [["clang", "-O2"], ["zig", "cc", "-O2"]]) {
    const r = spawnSync(cc[0], [...cc.slice(1), DIR + "nullchild.c", "-o", CHILD], { stdio: "ignore" });
    if (r.status === 0) { built = true; break; }
  }
  if (!built) {
    console.error("could not build nullchild.exe (need clang or zig in PATH)");
    process.exit(1);
  }
}

const now = () => Number(process.hrtime.bigint()) / 1e6;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function spawnAsync(mode) {
  if (IS_BUN) {
    const p = Bun.spawn({ cmd: [CHILD], stdin: "ignore", stdout: mode, stderr: mode });
    const reads = [];
    if (mode === "pipe") reads.push(p.stdout.text(), p.stderr.text());
    return Promise.all([p.exited, ...reads]).then(([code]) => {
      if (code !== 0) throw new Error("exit " + code);
    });
  }
  return new Promise((resolve, reject) => {
    const p = spawn(CHILD, [], { stdio: ["ignore", mode, mode] });
    if (mode === "pipe") { p.stdout.resume(); p.stderr.resume(); }
    p.on("error", reject);
    p.on("close", code => (code === 0 ? resolve() : reject(new Error("exit " + code))));
  });
}

function spawnSyncOnce() {
  if (IS_BUN) {
    const r = Bun.spawnSync({ cmd: [CHILD], stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    if (r.exitCode !== 0) throw new Error("exit " + r.exitCode);
  } else {
    const r = spawnSync(CHILD, [], { stdio: "ignore" });
    if (r.status !== 0) throw new Error("exit " + r.status);
  }
}

const rt = IS_BUN ? `bun ${Bun.version}` : `node ${process.versions.node}`;
console.log(`runtime: ${rt}   child: ${CHILD}`);
console.log(`UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? "(unset, default 4)"} (expected: no effect — see header)\n`);

// 1) sequential latency: sync vs async (paired alternation within each repeat)
{
  for (let i = 0; i < 3; i++) { spawnSyncOnce(); await spawnAsync("ignore"); }
  const repS = [], repA = [];
  for (let rep = 0; rep < 3; rep++) {
    const ts = [], ta = [];
    for (let i = 0; i < 12; i++) {
      let t0 = now(); spawnSyncOnce(); ts.push(now() - t0);
      t0 = now(); await spawnAsync("ignore"); ta.push(now() - t0);
    }
    repS.push(med(ts)); repA.push(med(ta));
  }
  console.log(`sequential ignore latency: sync ${med(repS).toFixed(2)} ms  async ${med(repA).toFixed(2)} ms  (async-sync = ${(med(repA) - med(repS)).toFixed(2)} ms; loop-integration check)`);
}

// 2) fan-out throughput. Cells are run REP-INTERLEAVED (every cell once per
// repeat, then again) so multi-second machine-state episodes (Defender burst
// scanning can 10x process-creation cost on dev boxes) spread across all cells
// instead of poisoning whole cells; medians across repeats then compare fairly.
const TOTAL = 64, REPEATS = 4;
const CELLS = [];
for (const mode of ["ignore", "pipe"]) for (const conc of [1, 8, 24]) CELLS.push({ mode, conc, rates: [] });
for (let rep = 0; rep < REPEATS; rep++) {
  for (const cell of CELLS) {
    let launched = 0;
    const t0 = now();
    const worker = async () => { while (launched < TOTAL) { launched++; await spawnAsync(cell.mode); } };
    await Promise.all(Array.from({ length: cell.conc }, worker));
    cell.rates.push(TOTAL / ((now() - t0) / 1000));
  }
}
console.log(`\nfan-out: ${TOTAL} children per cell, ${REPEATS} rep-interleaved repeats, spawns/s (min..max):`);
for (const { mode, conc, rates } of CELLS) {
  console.log(`  mode=${mode.padEnd(6)} conc=${String(conc).padEnd(2)}  ${med(rates).toFixed(0).padStart(5)} spawns/s   [${Math.min(...rates).toFixed(0)} .. ${Math.max(...rates).toFixed(0)}]`);
}
console.log("\nreading: the conc>=8 ceiling is serialized CreateProcessW (kernel) — it will NOT");
console.log("move with the libuv removal; watch that no cell regresses and that mode=pipe");
console.log("converges toward mode=ignore as native pooled pipes land (plan Phase 3.2/3.3).");
