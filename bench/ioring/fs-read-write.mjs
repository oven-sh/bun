// Benchmark: async node:fs read/write, Windows I/O Ring backend vs libuv
// threadpool. Measured scenarios:
//   1. N concurrent `fh.read()` of many small files (node_modules-shaped)
//   2. large sequential read via repeated `fh.read()` at increasing offsets
//   3. bulk small-file `fh.write()`
//
// Usage on Windows:
//   bun run build:release bench/ioring/fs-read-write.mjs
//   $env:BUN_FEATURE_FLAG_WINDOWS_IORING=1; bun run build:release bench/ioring/fs-read-write.mjs
//
// The flag is a no-op on non-Windows and on Windows older than build 22000,
// so both invocations produce identical numbers there.

import { open, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tag = process.env.BUN_FEATURE_FLAG_WINDOWS_IORING === "1" ? "ioring" : "uv-threadpool";

const N_SMALL = 512;
const SMALL = 2048;
const ITERS = 20;
const LARGE = 64 * 1024 * 1024;
const LARGE_CHUNK = 64 * 1024;

const root = join(tmpdir(), "bun-ioring-bench-" + Date.now());
await mkdir(root, { recursive: true });

function ms(t) {
  return (Number(process.hrtime.bigint() - t) / 1e6).toFixed(3);
}

async function withFiles(dir, n, size, open_, fn) {
  await mkdir(dir, { recursive: true });
  const fill = Buffer.alloc(size, 0x61);
  const names = [];
  for (let i = 0; i < n; i++) {
    const p = join(dir, `f${i}.bin`);
    await writeFile(p, fill);
    names.push(p);
  }
  const handles = await Promise.all(names.map(p => open(p, open_)));
  try {
    return await fn(handles);
  } finally {
    await Promise.all(handles.map(h => h.close().catch(() => {})));
    await rm(dir, { recursive: true, force: true });
  }
}

// ── 1. concurrent small reads ─────────────────────────────────────────────
await withFiles(join(root, "r"), N_SMALL, SMALL, "r", async handles => {
  const bufs = handles.map(() => Buffer.alloc(SMALL));
  // warmup (also primes the page cache)
  await Promise.all(handles.map((h, i) => h.read(bufs[i], 0, SMALL, 0)));

  let total = 0;
  for (let it = 0; it < ITERS; it++) {
    const t0 = process.hrtime.bigint();
    await Promise.all(handles.map((h, i) => h.read(bufs[i], 0, SMALL, 0)));
    total += Number(process.hrtime.bigint() - t0) / 1e6;
  }
  const avg = total / ITERS;
  console.log(
    `[${tag}] small-reads: ${N_SMALL} files x ${SMALL}B x ${ITERS} iters, ` +
      `avg ${avg.toFixed(3)} ms/iter (${((avg * 1000) / N_SMALL).toFixed(1)} us/file)`,
  );
});

// ── 2. large sequential read ──────────────────────────────────────────────
{
  const p = join(root, "large.bin");
  const chunk = Buffer.alloc(1024 * 1024, 0x4c);
  const wh = await open(p, "w");
  for (let i = 0; i < LARGE / chunk.length; i++) await wh.write(chunk);
  await wh.close();

  const fh = await open(p, "r");
  const buf = Buffer.alloc(LARGE_CHUNK);
  const nchunks = LARGE / LARGE_CHUNK;
  // warmup
  await fh.read(buf, 0, LARGE_CHUNK, 0);

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < nchunks; i++) {
    await fh.read(buf, 0, LARGE_CHUNK, i * LARGE_CHUNK);
  }
  console.log(
    `[${tag}] large-seq:   ${LARGE / 1024 / 1024}MB in ${LARGE_CHUNK / 1024}KB chunks, ${ms(t0)} ms`,
  );
  await fh.close();
  await rm(p, { force: true });
}

// ── 3. bulk small writes ──────────────────────────────────────────────────
await withFiles(join(root, "w"), N_SMALL, SMALL, "r+", async handles => {
  const buf = Buffer.alloc(SMALL, 0x77);
  // warmup
  await Promise.all(handles.map(h => h.write(buf, 0, SMALL, 0)));

  let total = 0;
  for (let it = 0; it < ITERS; it++) {
    const t0 = process.hrtime.bigint();
    await Promise.all(handles.map(h => h.write(buf, 0, SMALL, 0)));
    total += Number(process.hrtime.bigint() - t0) / 1e6;
  }
  const avg = total / ITERS;
  console.log(
    `[${tag}] small-writes: ${N_SMALL} files x ${SMALL}B x ${ITERS} iters, ` +
      `avg ${avg.toFixed(3)} ms/iter (${((avg * 1000) / N_SMALL).toFixed(1)} us/file)`,
  );
});

await rm(root, { recursive: true, force: true });
