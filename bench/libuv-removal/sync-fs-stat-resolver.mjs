// sync-fs-stat-resolver.mjs — Windows path-metadata throughput on a node_modules-like
// tree: statSync/lstatSync (uv today) vs existsSync/accessSync (native today).
//
// HEADLINE CLAIM (measured 2026-06-29, Win11 + active filter drivers): fs.existsSync
// and fs.accessSync cost ~20-30µs/op while fs.statSync — THROUGH LIBUV — costs ~4µs
// on the same paths in the same binary. The Phase 2 native sys layer, by routing
// exists/access/stat through the GetFileInformationByName / NtQueryInformationByName
// by-name query class (plan §7 open question 5 → yes), makes existsSync/accessSync
// ~3-7x faster. Resolver probe storms (tens of thousands of exists/stat calls per
// `bun install` / cold start) stop paying the query-open filter tax.
//
// WHY (verified same-binary, cross-checked vs node which shows identical numbers):
//   - fs.existsSync / fs.accessSync are ALREADY native — GetFileAttributesW on a
//     stack wide-path buffer (node_fs.rs:5511 → sys::exists_os_path,
//     src/sys/lib.rs:7044-7088; access at lib.rs:4165-4194). GetFileAttributesW is a
//     QUERY-OPEN-class operation: filter drivers (Defender et al) intercept it, and
//     on this machine it costs ~20-30µs hit or miss. Node's existsSync→uv_fs_access
//     ALSO uses GetFileAttributesW (libuv fs__access) and costs the same — proof the
//     tax is the syscall class, not the runtime.
//   - fs.statSync routes JS string → WTF-8 (node_fs.rs:7847) → sys_uv::stat
//     (src/sys/sys_uv.rs:527) → uv_fs_stat, and libuv ~v1.51 already uses the Win11
//     by-name fast path GetFileInformationByName(FileStatBasicByNameInfo) for
//     non-reparse hits AND misses (libuv src/win/fs.c:1770-1806) — ~4µs hits,
//     ~11-14µs misses here. The by-name information class largely dodges the filter
//     stack. libuv itself proves the native floor Phase 2 should adopt everywhere.
//
// SECONDARY (the actual uv-layer tax on statSync, bounded ~5-15%): per call libuv
// heap-allocates a WCHAR path copy + re-converts WTF-8→UTF-16 (fs__capture_path,
// fs.c:349,390,398 — the SECOND conversion; JS strings are already UTF-16), zeroes a
// ~440B uv_fs_t (fs.c:426-441), and translates errors twice (Win32→UV_E* in libuv,
// UV_E*→E in sys_uv.rs:14-17). On MISSES Bun additionally heap-copies the path into
// a rich sys::Error that throwIfNoEntry:false immediately discards
// (node_fs.rs:7872-7883) — visible as bun trailing node on the miss row today.
// TERTIARY: readdirSync per-entry cost (~0.3µs, already-native NtQueryDirectoryFile
// walk, src/sys/lib.rs:574+) vs per-file stat (~4µs) — enumeration headroom.
//
// RUN (before = today's libuv build; rerun after each Phase 2 migration step):
//   bun  bench/libuv-removal/sync-fs-stat-resolver.mjs
//   node bench/libuv-removal/sync-fs-stat-resolver.mjs   (cross-runtime reference; node is also libuv)
// Numbers are INDICATIVE (dev machine, Defender on): medians of 9 reps, warm cache,
// <30s total. On filter-excluded volumes (Dev Drive) the exists-vs-stat gap shrinks.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, ".fixtures", "stat-tree");
const NM = path.join(FIX, "node_modules");
const N_PKGS = 400;

function buildFixture() {
  if (fs.existsSync(path.join(FIX, ".done"))) return;
  fs.rmSync(FIX, { recursive: true, force: true });
  fs.mkdirSync(NM, { recursive: true });
  const pkgJson = i =>
    JSON.stringify(
      { name: `pkg-${i}`, version: "1.0.0", main: "index.js", description: "x".repeat(512) },
      null,
      2,
    );
  for (let i = 0; i < N_PKGS; i++) {
    const dir = path.join(NM, `pkg-${i}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "package.json"), pkgJson(i));
    fs.writeFileSync(path.join(dir, "index.js"), `module.exports = ${i};\n`);
  }
  fs.writeFileSync(path.join(FIX, ".done"), "ok");
}

buildFixture();

// hits: package.json of every package (the resolver's hottest probe)
const hits = [];
for (let i = 0; i < N_PKGS; i++) hits.push(path.join(NM, `pkg-${i}`, "package.json"));
// misses: half probe package.json under a NON-existent package dir (fails at dir
// component), half probe a missing file inside an EXISTING dir (fails at leaf).
const misses = [];
for (let i = 0; i < N_PKGS / 2; i++) misses.push(path.join(NM, `missing-${i}`, "package.json"));
for (let i = 0; i < N_PKGS / 2; i++) misses.push(path.join(NM, `pkg-${i}`, "package.json5"));

const NOTHROW = { throwIfNoEntry: false };
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
  const med = times[(times.length - 1) >> 1];
  return { name, med, min: times[0], max: times[times.length - 1] };
}

const results = [];
const run = (name, iters, fn) => {
  const r = bench(name, iters, fn);
  results.push(r);
  const opsPerSec = Math.floor(1e9 / r.med);
  console.log(
    `${name.padEnd(34)} ${r.med.toFixed(0).padStart(7)} ns/op  ` +
      `${opsPerSec.toLocaleString("en-US").padStart(11)} ops/s  ` +
      `(min ${r.min.toFixed(0)}, max ${r.max.toFixed(0)})`,
  );
  return r;
};

const isBun = typeof Bun !== "undefined";
console.log(`runtime: ${isBun ? "bun " + Bun.version : "node " + process.versions.node}  (${process.platform} ${process.arch})`);
console.log(`fixture: ${N_PKGS} packages under ${NM}`);
console.log("");

const ITERS = 12_000;

const statHit = run("statSync hit (package.json)", ITERS, n => {
  for (let i = 0; i < n; i++) sink += fs.statSync(hits[i % hits.length]).size;
});
run("lstatSync hit", ITERS, n => {
  for (let i = 0; i < n; i++) sink += fs.lstatSync(hits[i % hits.length]).size;
});
const statMiss = run("statSync miss (nothrow)", ITERS, n => {
  for (let i = 0; i < n; i++) sink += fs.statSync(misses[i % misses.length], NOTHROW) === undefined;
});
const exHit = run("existsSync hit  [GetFileAttributesW]", ITERS, n => {
  for (let i = 0; i < n; i++) sink += fs.existsSync(hits[i % hits.length]);
});
const exMiss = run("existsSync miss [GetFileAttributesW]", ITERS, n => {
  for (let i = 0; i < n; i++) sink += fs.existsSync(misses[i % misses.length]);
});
const accHit = run("accessSync hit  [GetFileAttributesW]", ITERS, n => {
  for (let i = 0; i < n; i++) {
    fs.accessSync(hits[i % hits.length]);
    sink++;
  }
});

// readdir control: per-entry cost of the already-native enumeration walk.
const rd = bench("readdirSync(node_modules) wFT", 200, n => {
  for (let i = 0; i < n; i++) sink += fs.readdirSync(NM, { withFileTypes: true }).length;
});
console.log(
  `${rd.name.padEnd(34)} ${(rd.med / N_PKGS).toFixed(0).padStart(7)} ns/entry (native NtQueryDirectoryFile walk)`,
);

console.log("");
console.log("ATTRIBUTION (same binary, same paths):");
console.log(
  `  by-name query (statSync hit, via libuv) ${statHit.med.toFixed(0)} ns  vs  ` +
    `query-open class (existsSync hit, native) ${exHit.med.toFixed(0)} ns  → ` +
    `${(exHit.med / statHit.med).toFixed(1)}x headroom for existsSync/accessSync on the by-name API`,
);
console.log(
  `  accessSync hit ${accHit.med.toFixed(0)} ns — same GetFileAttributesW class, same headroom`,
);
console.log(
  `  misses: statSync(nothrow) ${statMiss.med.toFixed(0)} ns vs existsSync ${exMiss.med.toFixed(0)} ns — ` +
    `by-name wins on misses too (${(exMiss.med / statMiss.med).toFixed(1)}x)`,
);
console.log(
  `  resolver framing: 100k exists-probes cost ${(exMiss.med / 10).toFixed(0)} ms today vs ` +
    `~${(statMiss.med / 10).toFixed(0)} ms on the by-name path libuv already proves`,
);
console.log(`(sink=${sink})`);
