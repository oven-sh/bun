// sync-fs-readsync-positioned.mjs — positioned fs.readSync pays a 3-syscall seek
// dance under libuv; native pread is 1 syscall.
//
// CLAIM: fs.readSync(fd, buf, off, len, POSITION) — the random-access pattern of
// database files, archive readers, and anything using FileHandle.read() (which
// passes a position by default) — does THREE kernel calls per read on Windows
// today. The native fs layer does ONE. Sequential readSync (position=null) is the
// in-binary control: it is the same uv plumbing minus the seek dance.
//
// MECHANISM: fs.readSync with a number position → pread → sys_uv::pread
// (src/sys/lib.rs:3679-3684, src/sys/sys_uv.rs:580) → uv_fs_read(offset>=0) →
// fs__read (libuv src/win/fs.c:846):
//   - SetFilePointerEx(handle, 0, &original, FILE_CURRENT)   — save position (fs.c:880)
//   - ReadFile(handle, ..., &overlapped_with_offset)          — the actual read
//   - SetFilePointerEx(handle, original, NULL, FILE_BEGIN)    — restore (fs.c:912-913)
// because ReadFile+OVERLAPPED moves the file position on synchronous handles and
// libuv emulates POSIX pread's "position unchanged" contract.
// Both variants also pay per call: uv__fd_hash_get under a process-global mutex
// (fs.c:863, FILEMAP bookkeeping Bun never uses) + CRT _get_osfhandle fd→HANDLE
// lookup (fs.c:870) + uv_fs_t setup/cleanup + double errno translation.
// The already-native HANDLE-fd pread in the same binary (src/sys/lib.rs:3679+,
// kernel32 ReadFile+OVERLAPPED, no save/restore) is unreachable from JS today
// because every JS-visible fd is made libuv-owned (sys_jsc/fd_jsc.rs:80-102).
// Kernel cost that STAYS: one ReadFile from page cache.
//
// MEASUREMENT: t(positioned) − t(pos=null) ≈ cost of the 2 extra SetFilePointerEx
// syscalls — pure removable overhead, measured in one binary with identical JS,
// arg-parsing, and uv-request costs on both sides. After the removal the positioned
// number should drop to ≈ the pos=null number.
//
// RUN (before = today's libuv build; rerun after the migration):
//   bun  bench/libuv-removal/sync-fs-readsync-positioned.mjs
//   node bench/libuv-removal/sync-fs-readsync-positioned.mjs   (same libuv dance)
// Numbers are INDICATIVE: medians of 9 reps, warm cache, <30s total.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, ".fixtures", "positioned");
const FILE = path.join(FIX, "data-1mb.bin");
const SIZE = 1024 * 1024;

if (!fs.existsSync(FILE)) {
  fs.mkdirSync(FIX, { recursive: true });
  fs.writeFileSync(FILE, Buffer.alloc(SIZE, 0x37));
}

let sink = 0;

function bench(name, iters, fn) {
  const REPS = 9, WARMUP = 2;
  const times = [];
  for (let r = 0; r < REPS + WARMUP; r++) {
    const t0 = process.hrtime.bigint();
    fn(iters);
    const t1 = process.hrtime.bigint();
    if (r >= WARMUP) times.push(Number(t1 - t0) / iters);
  }
  times.sort((a, b) => a - b);
  return { name, med: times[(times.length - 1) >> 1], min: times[0], max: times[times.length - 1] };
}

const run = (name, iters, fn) => {
  const r = bench(name, iters, fn);
  const opsPerSec = Math.floor(1e9 / r.med);
  console.log(
    `${name.padEnd(40)} ${r.med.toFixed(0).padStart(7)} ns/op  ` +
      `${opsPerSec.toLocaleString("en-US").padStart(11)} ops/s  ` +
      `(min ${r.min.toFixed(0)}, max ${r.max.toFixed(0)})`,
  );
  return r;
};

const isBun = typeof Bun !== "undefined";
console.log(`runtime: ${isBun ? "bun " + Bun.version : "node " + process.versions.node}  (${process.platform} ${process.arch})`);
console.log("");

const fd = fs.openSync(FILE, "r");
const buf4k = Buffer.alloc(4096);
const buf64 = Buffer.alloc(64);
const N_BLOCKS = SIZE / 4096;

const seq4k = run("readSync 4KB pos=null (1 ReadFile)", 40_000, n => {
  // Rewind by making every N_BLOCKS-th read positioned-at-0 (1/256 of iters);
  // contamination is tiny and biases the measured difference DOWN (conservative).
  for (let i = 0; i < n; i++) {
    sink += fs.readSync(fd, buf4k, 0, 4096, i % N_BLOCKS === 0 ? 0 : null);
  }
});
const pos4k = run("readSync 4KB positioned (3 syscalls)", 40_000, n => {
  for (let i = 0; i < n; i++) {
    sink += fs.readSync(fd, buf4k, 0, 4096, ((i % N_BLOCKS) * 4096) % (SIZE - 4096));
  }
});
const seq64 = run("readSync 64B pos=null", 40_000, n => {
  for (let i = 0; i < n; i++) {
    sink += fs.readSync(fd, buf64, 0, 64, i % 16384 === 0 ? 0 : null);
  }
});
const pos64 = run("readSync 64B positioned", 40_000, n => {
  for (let i = 0; i < n; i++) {
    sink += fs.readSync(fd, buf64, 0, 64, (i * 64) % (SIZE - 64));
  }
});
fs.closeSync(fd);

console.log("");
console.log("ATTRIBUTION (same binary, identical JS + uv plumbing on both sides):");
const d4k = pos4k.med - seq4k.med;
const d64 = pos64.med - seq64.med;
console.log(
  `  4KB:  positioned − sequential = ${d4k.toFixed(0)} ns/op  (+${((d4k / seq4k.med) * 100).toFixed(0)}%)  ` +
    `= the SetFilePointerEx save/restore pair`,
);
console.log(
  `  64B:  positioned − sequential = ${d64.toFixed(0)} ns/op  (+${((d64 / seq64.med) * 100).toFixed(0)}%)`,
);
console.log(`  after the migration, positioned should converge to ≈ sequential (1 kernel read either way)`);
console.log(`(sink=${sink})`);
