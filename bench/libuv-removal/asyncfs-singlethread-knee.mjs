// asyncfs-singlethread-knee.mjs
//
// PURPOSE: single-JS-thread concurrency sweep for the 7 libuv-routed async
// node:fs ops on Windows — the post-migration REGRESSION GATE, plus the
// single-thread half of the "no pool width fits all workloads" evidence.
//
// CLAIM: a single JS thread doing Promise.all'd FileHandle.read()s is at the
// mercy of libuv's process-global pool WIDTH, and the width cannot be tuned
// without breaking some other workload in the same process:
//   fh.read 4KB, N=16..32 concurrent (measured, Win11 24 cores, bun 1.4.0):
//     default (4 uv threads): ~704-745k ops/s
//     UV_THREADPOOL_SIZE=24:  ~229-233k ops/s   <- 3.2x REGRESSION from the
//       same env knob that gives +60% to the 8-worker workload (see sibling
//       asyncfs-workers-global-pool.mjs). One global width must serve every
//       loop and every workload; no value works for both ends.
//   fsp.stat (Bun's WorkPool, 24 threads — the post-removal model) is
//   knob-IMMUNE in the same binary: ~470k vs ~478k at N=32. After libuv
//   removal (this removal) the fh.read rows must be >= today's default rows
//   (745k) — and the pathology class disappears with the knob itself.
//
// SECONDARY HONEST FINDINGS the rows document:
//   - open+close (2 uv hops/op) is JS/dispatch-bound at ~126k it/s from N=16;
//     pool width does ~nothing (116k at =24). Don't claim pool wins there.
//   - uv's batched wq drain is GOOD at low concurrency: fh.read N=4 (421k)
//     beats WorkPool stat N=4 (139k) per-completion — note reads do less
//     kernel work than stats, so this is indicative only. The migration's
//     AsyncFSTask delivery must keep up where uv batching used to: that is
//     what this gate catches.
//   - whether default fh.read N=32 (745k) is capped by the 4 uv threads or by
//     the JS thread is NOT determinable today (widening triggers the churn
//     pathology instead) — the post-migration run answers it: >745k means the
//     pool was the wall.
//
// MECHANISM refs: UVFSRequest ops src/runtime/node/node_fs.rs:513-563; libuv
// global pool + single mutex/cond vendor libuv src/threadpool.c:33-44,66-161;
// completion delivery via per-loop wq + uv_async_send threadpool.c:125-130;
// WorkPool = cores-sized lock-free queue src/threading/work_pool.rs:138,
// src/threading/ThreadPool.rs:86-204. Plan: the libuv-removal work
// §2.3, the removal.
//
// Ops covered (src/runtime/node/node_fs.rs:508-563):
//   uv pool today:   fsPromises.open+close (Open/Close), fh.read (Read)
//   WorkPool today:  fsPromises.stat (Stat), fsPromises.readFile (ReadFile)
//     — the WorkPool rows double as the same-binary reference curve.
//
// RUN:  bun bench/libuv-removal/asyncfs-singlethread-knee.mjs
//       node bench/libuv-removal/asyncfs-singlethread-knee.mjs   (sanity ref)
// Parent re-execs itself for default env and UV_THREADPOOL_SIZE=24.
// Median of 5 x 250ms windows per point.

import fsp from "node:fs/promises";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const NFILES = 64;
const READ_SIZE = 4096;
const FILE_SIZE = 64 * 1024;
const CONCURRENCY = [1, 4, 16, 32];
const REPEATS = 5;
const WINDOW_MS = 250;

const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];

async function measureWindow(op, N, ms) {
  let stop = false;
  let ops = 0;
  const t0 = process.hrtime.bigint();
  const loops = [];
  for (let w = 0; w < N; w++) {
    loops.push(
      (async () => {
        let i = w;
        while (!stop) {
          await op(i, w);
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

if (process.argv[2] === "--child") {
  const dir = mkdtempSync(join(tmpdir(), "uv-st-knee-"));
  try {
    const files = [];
    const payload = Buffer.alloc(FILE_SIZE, 0xef);
    for (let i = 0; i < NFILES; i++) {
      const p = join(dir, `f${i}.bin`);
      writeFileSync(p, payload);
      files.push(p);
    }
    const maxN = CONCURRENCY[CONCURRENCY.length - 1];
    const fhs = await Promise.all(files.map(f => fsp.open(f, "r")));
    const bufs = Array.from({ length: maxN }, () => Buffer.alloc(READ_SIZE));

    const ops = [
      // 2 uv-pool hops per iteration today (UVFSRequest Open + Close)
      [
        "open+close   (uv pool today)",
        async i => {
          const fh = await fsp.open(files[i % NFILES], "r");
          await fh.close();
        },
      ],
      // 1 uv-pool hop per iteration today (UVFSRequest Read)
      [
        "fh.read 4KB  (uv pool today)",
        async (i, w) => void (await fhs[i % fhs.length].read(bufs[w], 0, READ_SIZE, 0)),
      ],
      // WorkPool reference rows (already the "after" model)
      ["fsp.stat     (WorkPool)     ", async i => void (await fsp.stat(files[i % NFILES]))],
      ["fsp.readFile (WorkPool)     ", async i => void (await fsp.readFile(files[i % NFILES]))],
    ];

    console.log(
      `  ${typeof Bun !== "undefined" ? "bun " + Bun.version : "node " + process.version} ` +
        `UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? "(unset)"}`,
    );
    for (const [name, op] of ops) {
      await measureWindow(op, 4, 150); // warmup
      for (const N of CONCURRENCY) {
        const rates = [];
        for (let r = 0; r < REPEATS; r++) rates.push(await measureWindow(op, N, WINDOW_MS));
        const med = median(rates);
        console.log(
          `  ${name} N=${String(N).padStart(2)}  ${Math.round(med).toLocaleString().padStart(8)} ops/s  ` +
            `[spread ${Math.round(Math.min(...rates) / 1000)}k..${Math.round(Math.max(...rates) / 1000)}k]`,
        );
      }
    }
    for (const fh of fhs) await fh.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  const rt = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
  console.log(`Single-JS-thread async fs concurrency sweep — ${rt}`);
  console.log(
    "(regression gate for the UVFSRequest->WorkPool migration: rows must not drop.\n" +
      " The =24 pass shows libuv's pool cannot be widened without a ~3x single-\n" +
      " thread fh.read regression — the WorkPool rows are knob-immune)\n",
  );
  for (const [label, env] of [
    ["default env", {}],
    ["UV_THREADPOOL_SIZE=24", { UV_THREADPOOL_SIZE: "24" }],
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
