// asyncfs-bunfile-vs-readfile.mjs
//
// CLAIM: On Windows, `Bun.file(p).arrayBuffer()` is ~1.5-2x slower than
// `fs.promises.readFile(p)` for the SAME files at the same concurrency,
// because the Blob read path is implemented as a CHAIN of async libuv fs
// requests. Removing libuv (migrating Blob reads to the single-WorkPool-task
// model POSIX uses) makes `Bun.file()` reads match or beat `readFile`.
//
// MECHANISM (the async-fs WorkPool migration):
//   - Bun.file() reads on Windows = `ReadFileUV`
//     (src/runtime/webcore/blob/read_file.rs:915-1200): uv_fs_open ->
//     uv_fs_fstat -> uv_fs_read loop -> uv_fs_close. EVERY step is a separate
//     libuv threadpool hop + uv_async loop wakeup + JS-thread completion
//     (vendor libuv src/threadpool.c:125-130 posts each completion to the
//     loop's wq_async). A 64KB read = 4+ round trips through pool + event loop.
//   - fs.promises.readFile = AsyncFSTask (src/runtime/node/node_fs.rs:540-541):
//     ONE Bun WorkPool task runs open+fstat+read+close synchronously
//     (node_fs.rs:7015 read_file), one completion back to the JS thread.
//   - Same kernel work, 4x the scheduling overhead for Bun.file today.
//   - this removal migrates Blob ReadFileUV to the WorkPool model, deleting the
//     extra hops. EXPECTED AFTER: Bun.file().arrayBuffer() >= readFile.
//
// ATTRIBUTION CONTROL: the script re-runs itself with UV_THREADPOOL_SIZE=24.
// The gap does NOT close with a bigger pool (measured: Bun.file 60k -> 54k
// ops/s at N=32, i.e. unchanged/noise), proving the cost is the per-op hop
// architecture, not the 4-thread pool cap. readFile is the same-binary proxy
// for the "after" state (1 pool task per logical read).
//
// RUN (today, baseline):     bun bench/libuv-removal/asyncfs-bunfile-vs-readfile.mjs
// RUN (after the migration):     same command; Bun.file row should jump to ~readFile level.
// Bun-only (uses Bun.file). Numbers are indicative; dev-machine rules:
// time-boxed windows, median of 5 repeats, spread reported.
//
// Measured today (Win11, 24 cores, bun 1.4.0, 64KB files, hot page cache;
// two runs, run-to-run dev-machine variance shown as ranges):
//   N=1:  Bun.file ~8-13k ops/s    readFile ~10-18k ops/s    (~1.2-1.5x)
//   N=16: Bun.file ~48-51k ops/s   readFile ~77-84k ops/s    (~1.5-1.7x)
//   N=32: Bun.file ~52-60k ops/s   readFile ~84-111k ops/s   (~1.6-1.9x)
//   =24 control: gap unchanged or wider (1.81x at N=32).

import fsp from "node:fs/promises";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (typeof Bun === "undefined") {
  console.error("This benchmark uses Bun.file() and must run under bun.");
  process.exit(1);
}

const SELF = fileURLToPath(import.meta.url);
const NFILES = 64;
const SIZE = 64 * 1024;
const CONCURRENCY = [1, 4, 16, 32];
const REPEATS = 5;
const WINDOW_MS = 250;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

async function measureWindow(op, files, N, ms) {
  let stop = false;
  let ops = 0;
  const t0 = process.hrtime.bigint();
  const loops = [];
  for (let w = 0; w < N; w++) {
    loops.push(
      (async () => {
        let i = w;
        while (!stop) {
          await op(files[i % files.length]);
          ops++;
          i += N;
        }
      })(),
    );
  }
  await new Promise(r => setTimeout(r, ms));
  stop = true;
  await Promise.all(loops);
  return ops / (Number(process.hrtime.bigint() - t0) / 1e9);
}

async function bench() {
  const dir = mkdtempSync(join(tmpdir(), "bunfile-vs-readfile-"));
  const files = [];
  try {
    const payload = Buffer.alloc(SIZE, 0xab);
    for (let i = 0; i < NFILES; i++) {
      const p = join(dir, `f${i}.bin`);
      writeFileSync(p, payload);
      files.push(p);
    }

    const ops = [
      ["Bun.file().arrayBuffer", async p => void (await Bun.file(p).arrayBuffer())],
      ["fsp.readFile           ", async p => void (await fsp.readFile(p))],
    ];

    console.log(
      `  bun ${Bun.version} UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? "(unset: uv pool=4, WorkPool=cores)"}`,
    );
    const at = {}; // headline: rate at max N per op
    for (const [name, op] of ops) {
      await measureWindow(op, files, 4, 150); // warmup (pool threads + page cache)
      for (const N of CONCURRENCY) {
        const rates = [];
        for (let r = 0; r < REPEATS; r++) rates.push(await measureWindow(op, files, N, WINDOW_MS));
        const med = median(rates);
        if (N === CONCURRENCY[CONCURRENCY.length - 1]) at[name.trim()] = med;
        console.log(
          `  ${name} N=${String(N).padStart(2)}  ${Math.round(med).toLocaleString().padStart(8)} ops/s  ` +
            `(${((med * SIZE) / 1e9).toFixed(2)} GB/s)  ` +
            `[spread ${Math.round(Math.min(...rates) / 1000)}k..${Math.round(Math.max(...rates) / 1000)}k]`,
        );
      }
    }
    const ratio = at["fsp.readFile"] / at["Bun.file().arrayBuffer"];
    console.log(
      `  => readFile is ${ratio.toFixed(2)}x faster than Bun.file() at N=${CONCURRENCY.at(-1)}.` +
        (ratio > 1.15
          ? " (libuv chained-hop overhead present)"
          : " (gap closed - migration done?)"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--child") {
  await bench();
} else {
  console.log("Bun.file().arrayBuffer() vs fs.promises.readFile(), same 64KB files, hot cache");
  console.log("(after libuv removal the removal, the Bun.file row should match/beat readFile)\n");
  for (const [label, env] of [
    ["default env (libuv pool = 4 threads)", {}],
    ["UV_THREADPOOL_SIZE=24 control (gap should NOT close -> not a pool-width problem)", { UV_THREADPOOL_SIZE: "24" }],
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
