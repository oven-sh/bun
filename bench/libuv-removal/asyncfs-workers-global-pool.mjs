// asyncfs-workers-global-pool.mjs
//
// CLAIM: On Windows, async fd reads (fs.promises FileHandle.read — one of the
// 7 libuv-routed node:fs ops) from multiple worker_threads all squeeze through
// libuv's PROCESS-GLOBAL threadpool, and its one-size design forces a
// lose-lose tuning choice on a many-core machine:
//   - default (4 threads): multi-worker read throughput WALLS at ~680k ops/s,
//     flat from 16-way concurrency upward (the 4-thread cap);
//   - UV_THREADPOOL_SIZE=24 (the documented mitigation): +60% at 32-way
//     (~1.09M ops/s) but -60% at 8-way (235k vs 631k) — a wide mostly-idle uv
//     pool churns on its single global mutex+cond.
// fs.promises.stat — already on Bun's lock-free WorkPool (24 threads), the
// model ALL 7 ops adopt after libuv removal — scales monotonically in the
// same binary with no knob and no low-concurrency penalty. After removal,
// cores-wide async fs parallelism is the DEFAULT and UV_THREADPOOL_SIZE
// stops mattering.
//
// MECHANISM:
//   - fh.read/write/open/close/readv/writev/statfs = UVFSRequest
//     (src/runtime/node/node_fs.rs:513-563, Windows-only) -> async uv_fs_* on
//     libuv's global pool: default 4 threads (vendor libuv
//     src/threadpool.c:39,204), ONE process-wide mutex+cond shared by every
//     worker thread and every event loop (threadpool.c:33-34); the mutex is
//     taken on every submit (post(), :143-161) and twice per task in the
//     worker loop (:66-138), plus a per-loop wq_mutex + uv_async_send per
//     completion (:125-130). 4 threads cap throughput; 24 threads trade the
//     cap for handoff churn when concurrency is below the thread count.
//   - fs.promises.stat = AsyncFSTask on Bun's WorkPool
//     (node_fs.rs:552, src/threading/work_pool.rs:138): max_threads =
//     get_thread_count() = cores; lock-free run queue + futex idle/wake +
//     work stealing (src/threading/ThreadPool.rs:86-204). Monotonic scaling,
//     knob-insensitive.
//   - Plan refs: the libuv-removal work.3 ("Truly-async fs: 7 ops
//     via UVFSRequest"), the removal (migrate the 7 ops to the WorkPool model).
//
// BEFORE/AFTER:
//   today (baseline):  the two passes below show the lose-lose: a wall at 4
//                      threads OR a low-concurrency regression at 24.
//   after the migration:   read rows should look like the stat rows — monotonic,
//                      >= today's default at every W, >= ~1.09M at 8 workers
//                      (the =24 pass proves the kernel+delivery can do it),
//                      identical with and without UV_THREADPOOL_SIZE.
//   cross-runtime ref: node THIS-FILE — in node BOTH ops ride the libuv pool,
//                      so the stat rows show the same pathologies too.
//
// RUN:  bun bench/libuv-removal/asyncfs-workers-global-pool.mjs
//       node bench/libuv-removal/asyncfs-workers-global-pool.mjs   (reference)
// The parent re-execs itself for the two env configs; workers persist across
// repeat windows. Median of 3 x 300ms windows (1 discarded warmup window —
// IMPORTANT: cold first-window numbers understate wide-pool configs ~3x
// because worker JIT + pool thread spawn land inside the window).
//
// Measured today (Win11, 24 cores, bun 1.4.0, 4KB reads, hot cache, 4
// concurrent reads per worker; two runs):
//   fh.read default:  245-250k (W=1) -> 531-631k (W=2) -> 671-687k (W=4)
//                     -> 679-684k (W=8)            [wall at ~680k from W=4]
//   fh.read =24:      227-229k (W=1) -> 235-253k (W=2, REGRESSION)
//                     -> 604-656k (W=4) -> 1,017k-1,094k (W=8)  [+49..+61%]
//   fsp.stat both:    ~117-145k (W=1) -> ~480-624k (W=8), no knob effect
//                     beyond run noise
//   node v25.8.1 reference (BOTH ops uv-pooled there): same lose-lose on both
//   — read default 273k->754k, =24 W=1..4 -30..-61% (190k/241k/279k), W=8
//   ties (776k); stat default 109k->396k, =24 W=4 -29% (282k), W=8 +24%
//   (490k). Bun's stat rows being knob-immune while node's are NOT is the
//   architectural discriminator: the pathology lives in libuv's pool.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 4096; // small reads isolate SCHEDULING cost from memcpy cost
const PER_WORKER_CONC = 4;
const WORKER_COUNTS = [1, 2, 4, 8];
const WINDOWS = 4; // first is discarded as warmup
const WINDOW_MS = 300;
const FILES_PER_WORKER = 4;

// ── worker ────────────────────────────────────────────────────────────────
if (!isMainThread) {
  // NOTE: no top-level await before the message loop — under bun, a worker
  // blocked in TLA does not receive parentPort messages.
  (async () => {
    const { files, op } = workerData;
    const fsp = await import("node:fs/promises");
    let fhs = [];
    if (op === "read") fhs = await Promise.all(files.map(f => fsp.open(f, "r")));
    const bufs = Array.from({ length: PER_WORKER_CONC }, () => Buffer.alloc(SIZE));
    const one =
      op === "read"
        ? async (i, w) => void (await fhs[i % fhs.length].read(bufs[w], 0, SIZE, 0))
        : async i => void (await fsp.stat(files[i % files.length]));
    for (let i = 0; i < 100; i++) await one(i, 0); // spin up pool threads
    parentPort.postMessage("ready");
    parentPort.on("message", async msg => {
      if (msg.cmd === "bye") {
        for (const fh of fhs) await fh.close();
        process.exit(0);
      }
      // cmd === "go": one measurement window
      let stop = false;
      let ops = 0;
      const t0 = process.hrtime.bigint();
      const loops = [];
      for (let w = 0; w < PER_WORKER_CONC; w++) {
        loops.push(
          (async () => {
            let i = w;
            while (!stop) {
              await one(i, w);
              ops++;
              i += PER_WORKER_CONC;
            }
          })(),
        );
      }
      await new Promise(r => setTimeout(r, msg.ms));
      stop = true;
      await Promise.all(loops);
      parentPort.postMessage(ops / (Number(process.hrtime.bigint() - t0) / 1e9));
    });
  })();
} else if (process.argv[2] === "--child") {
  // ── one benchmark pass in a fixed env ───────────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), "uv-global-pool-"));
  try {
    const maxW = WORKER_COUNTS[WORKER_COUNTS.length - 1];
    const files = [];
    const payload = Buffer.alloc(SIZE, 0xcd);
    for (let i = 0; i < maxW * FILES_PER_WORKER; i++) {
      const p = join(dir, `f${i}.bin`);
      writeFileSync(p, payload);
      files.push(p);
    }
    const SELF = fileURLToPath(import.meta.url);
    const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];

    for (const op of ["read", "stat"]) {
      for (const W of WORKER_COUNTS) {
        const workers = [];
        const pending = []; // FIFO of resolvers for rate messages
        let ready = 0;
        await new Promise(resolveReady => {
          for (let w = 0; w < W; w++) {
            const wk = new Worker(SELF, {
              workerData: {
                files: files.slice(w * FILES_PER_WORKER, (w + 1) * FILES_PER_WORKER),
                op,
              },
            });
            wk.on("message", m => {
              if (m === "ready") {
                if (++ready === W) resolveReady();
              } else pending.shift()(m);
            });
            wk.on("error", e => {
              console.error("worker error:", e);
              process.exit(1);
            });
            workers.push(wk);
          }
        });
        const sums = [];
        for (let win = 0; win < WINDOWS; win++) {
          const rates = await Promise.all(
            workers.map(wk => {
              const p = new Promise(r => pending.push(r));
              wk.postMessage({ cmd: "go", ms: WINDOW_MS });
              return p;
            }),
          );
          if (win > 0) sums.push(rates.reduce((a, b) => a + b, 0)); // window 0 = warmup
        }
        for (const wk of workers) wk.postMessage({ cmd: "bye" });
        await Promise.all(workers.map(wk => new Promise(r => wk.on("exit", r))));
        const med = median(sums);
        const statLabel =
          typeof Bun !== "undefined" ? "fsp.stat (Bun WorkPool) " : "fsp.stat (uv pool/node)";
        console.log(
          `  ${op === "read" ? "fh.read 4KB (uv pool)   " : statLabel}` +
            `workers=${W} (conc=${String(W * PER_WORKER_CONC).padStart(2)})  ` +
            `${Math.round(med).toLocaleString().padStart(9)} ops/s  ` +
            `[spread ${Math.round(Math.min(...sums) / 1000)}k..${Math.round(Math.max(...sums) / 1000)}k]`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  // ── orchestrator: default env vs UV_THREADPOOL_SIZE=24 ──────────────────
  const SELF = fileURLToPath(import.meta.url);
  const rt = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
  console.log(`Multi-worker async fs on the process-global libuv pool — ${rt}`);
  console.log(
    "(after libuv removal, the fh.read rows should behave like the fsp.stat rows:\n" +
      " scale with workers, no UV_THREADPOOL_SIZE sensitivity)\n",
  );
  for (const [label, env] of [
    ["default env: libuv pool = 4 threads (global), Bun WorkPool = cores", {}],
    ["UV_THREADPOOL_SIZE=24: the documented mitigation — lose-lose: faster at 32-way, 2-3x slower at 8-way", { UV_THREADPOOL_SIZE: "24" }],
  ]) {
    console.log(`--- ${label}`);
    const r = spawnSync(process.execPath, [SELF, "--child"], {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
    console.log();
  }
}
