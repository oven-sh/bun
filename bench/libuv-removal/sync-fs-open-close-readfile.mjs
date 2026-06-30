// sync-fs-open-close-readfile.mjs — Windows openSync/closeSync cycle + small readFileSync.
//
// CLAIM (deliberately bounded; measured 2026-06-29): deleting libuv's CRT-fd layer
// shaves the fixed per-open/per-close/per-read plumbing — worth ~10-20% on
// openSync+closeSync cycles — but on filter-protected directories (Defender on),
// readFileSync of small files is DOMINATED by a ~40µs open-with-read-data +
// first-read filter cost that both bun and node pay identically (~53-55µs/file,
// ~19k files/s in BOTH runtimes). Do not promise big small-file readFileSync wins
// from libuv removal alone on protected volumes; on excluded/Dev Drive volumes the
// uv share of the total is much larger.
//
// MECHANISM — what IS removable (LIBUV_WINDOWS_REMOVAL_PLAN.md §2.3, decision #3):
// fs.openSync routes through sys_uv::open (src/sys/sys_uv.rs:102) → uv_fs_open:
//   - heap-allocates the UTF-16 path copy (fs__capture_path, libuv src/win/fs.c:349),
//   - calls _umask(0)+_umask(prev) — two CRT global-state calls (fs.c:476-477),
//   - CreateFileW, then MINTS A CRT FD via _open_osfhandle (fs.c:632) — a locked
//     CRT fd-table allocation (the dual-Fd encoding the plan deletes; ~512-slot cap).
// fs.closeSync → fs__close: uv__fd_hash_remove under a process-global mutex
// (fs.c:706) + CRT _close (locked table release + CloseHandle).
// Every fs.readSync on that fd re-enters the global fd-hash mutex + CRT
// _get_osfhandle lookup before ReadFile (fs.c:861-870).
// fs.readFileSync(path) = uv open + uv read(s) + uv close (node_fs.rs:7103-7131),
// so it pays the whole stack per file.
// Kernel+filter cost that STAYS: name resolution + create-time filter callbacks +
// scan-on-first-read for data opens, + ReadFile + CloseHandle. The planned native
// path is NtCreateFile → HANDLE-kind fd (no CRT mint, no heap path copy, no global
// locks) — the same call the `-at` family already uses (src/sys/lib.rs:6738+).
//
// FAILED CONTROL, kept as a finding: readdirSync(emptyDir) — the already-native
// open+NtQueryDirectoryFile+close (src/sys/lib.rs:574+) — measured ~19µs, SLOWER
// than uv openSync+closeSync (~10-12µs). Directory-list opens are a different
// kernel/filter class than file opens; cross-OP "comparable kernel cost"
// comparisons are invalid on filtered Windows volumes. Per-op attribution must
// come from same-op deltas (sync-fs-readsync-positioned.mjs) or before/after.
//
// Bonus non-libuv observation: readFileSync 64KB is ~1.6x faster in bun than node
// (bun's single pre-stat 256KB read vs node's fstat+sized-read sequence) — JS-layer
// difference, unrelated to this plan.
//
// RUN (before = today's libuv build; rerun after Phase 2):
//   bun  bench/libuv-removal/sync-fs-open-close-readfile.mjs
//   node bench/libuv-removal/sync-fs-open-close-readfile.mjs
// Numbers are INDICATIVE: medians of 9 reps, warm cache, <30s total.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, ".fixtures", "small-files");
const N_FILES = 256;

function buildFixture() {
  if (fs.existsSync(path.join(FIX, ".done"))) return;
  fs.rmSync(FIX, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIX, "emptydir"), { recursive: true });
  const oneKB = Buffer.alloc(1024, 0x61);
  for (let i = 0; i < N_FILES; i++) {
    fs.writeFileSync(path.join(FIX, `f-${i}.txt`), oneKB);
  }
  fs.writeFileSync(path.join(FIX, "big-64k.bin"), Buffer.alloc(64 * 1024, 0x62));
  fs.writeFileSync(path.join(FIX, ".done"), "ok");
}

buildFixture();

const files = [];
for (let i = 0; i < N_FILES; i++) files.push(path.join(FIX, `f-${i}.txt`));
const emptyDir = path.join(FIX, "emptydir");
const big = path.join(FIX, "big-64k.bin");

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

const results = [];
const run = (name, iters, fn) => {
  const r = bench(name, iters, fn);
  results.push(r);
  const opsPerSec = Math.floor(1e9 / r.med);
  console.log(
    `${name.padEnd(36)} ${r.med.toFixed(0).padStart(7)} ns/op  ` +
      `${opsPerSec.toLocaleString("en-US").padStart(11)} ops/s  ` +
      `(min ${r.min.toFixed(0)}, max ${r.max.toFixed(0)})`,
  );
  return r;
};

const isBun = typeof Bun !== "undefined";
console.log(`runtime: ${isBun ? "bun " + Bun.version : "node " + process.versions.node}  (${process.platform} ${process.arch})`);
console.log("");

const openClose = run("openSync+closeSync (1KB file)", 6_000, n => {
  for (let i = 0; i < n; i++) {
    const fd = fs.openSync(files[i % N_FILES], "r");
    fs.closeSync(fd);
    sink += fd;
  }
});
const dirPath = FIX;
const openCloseDir = run("openSync+closeSync (directory)", 6_000, n => {
  for (let i = 0; i < n; i++) {
    const fd = fs.openSync(dirPath, "r");
    fs.closeSync(fd);
    sink += fd;
  }
});
const rdEmpty = run("readdirSync(emptyDir) [native ctrl]", 6_000, n => {
  for (let i = 0; i < n; i++) sink += fs.readdirSync(emptyDir).length;
});
const rf1k = run("readFileSync 1KB (Buffer)", 6_000, n => {
  for (let i = 0; i < n; i++) sink += fs.readFileSync(files[i % N_FILES]).length;
});
run("readFileSync 64KB (Buffer)", 3_000, n => {
  for (let i = 0; i < n; i++) sink += fs.readFileSync(big).length;
});
// open + single readSync + close decomposition, to separate the per-read cost
const fd0 = fs.openSync(files[0], "r");
const buf = Buffer.alloc(1024);
run("readSync 1KB on open fd (pos=null)", 40_000, n => {
  for (let i = 0; i < n; i++) sink += fs.readSync(fd0, buf, 0, 1024, null);
});
fs.closeSync(fd0);

console.log("");
console.log("READING THE NUMBERS:");
console.log(
  `  readFileSync(1KB) ${rf1k.med.toFixed(0)} ns vs its parts (open+close ${openClose.med.toFixed(0)} + ` +
    `readSync ~1800) → ~${(rf1k.med - openClose.med - 1800).toFixed(0)} ns/file of filter-driver ` +
    `scan cost neither runtime controls`,
);
console.log(
  `  readdirSync(emptyDir) ${rdEmpty.med.toFixed(0)} ns vs openSync+closeSync(dir) ${openCloseDir.med.toFixed(0)} ns — ` +
    `native-vs-uv cross-OP comparison is invalid on filtered volumes (different filter class)`,
);
console.log(
  `  small-file throughput today: ${Math.floor(1e9 / rf1k.med).toLocaleString("en-US")} files/s single-threaded`,
);
console.log(`(sink=${sink})`);
