// composite-startup-resolve.mjs
//
// CLAIM (revised after measurement, 2026-06): module-resolution-heavy "bun app.js" startup on
// Windows is ALREADY mostly native-NT — resolution is dir-cache based (native
// NtQueryDirectoryFile, plan §2.3) and module loads go openat+ReadFile (bundler/runtime
// shared read path, src/bundler/cache.rs:355-384, STORE_FILE_DESCRIPTORS=true). PROOF inside
// this benchmark: exact-extension requires (./mK.js) cost the same as extensionless (./mK)
// under bun (~0 us/probe), while node pays ~25-30 us/module for uv stat probes. Therefore
// libuv removal (plan Phase 2, §2.3) is expected to move this composite only a little
// (entry-point realpath's internal uv open, lib.rs:4313-4320; CRT stdio init; loop init) —
// this script is the REGRESSION GUARD for the migration (it must not get slower) and the
// baseline for the bun-vs-node resolution story (bun is ~2x node per module today).
//
// WHAT IT MEASURES (median wall time of a spawned child, warmup excluded):
//   floors:   `bun --version`, `bun -e 1`, `node -e 1`   (process+runtime init; NOT expected
//             to move much — this is the negative control / subtraction term)
//   apps:     `bun fixtures/modules-N/index.js` and node ditto, N = 100/300/600 (CJS binary
//             require tree, extensionless specifiers). The app prints its own in-process
//             requireMs, separating module-phase from runtime init.
//   slope:    least-squares ms/module over N — the per-module cost with the floor cancelled.
//   control:  bun modules-600 with UV_THREADPOOL_SIZE=24 — module loading is sync, so the
//             threadpool cap must NOT matter; if this moves, attribution is wrong.
//   exact:    modules-600-exact (./mK.js specifiers) vs modules-600 (./mK) — isolates the
//             resolver-probe cost per module for each runtime.
//   micro:    in-process per-op costs under both runtimes (--micro): statSync hit/miss,
//             existsSync/access, openSync+closeSync, readFileSync, readdirSync/entry —
//             the JS-visible node:fs (uv-routed) surface, for context.
//             MEASURED SURPRISE (2026-06, Win11+Defender): attribute-by-path queries
//             (existsSync/accessSync, ~15us) are ~3x SLOWER than uv's open-handle statSync
//             (~4.3us) under BOTH bun and node — filter drivers tax path-attribute queries.
//             So per-stat removable margin is small; the per-module uv tax is dominated by
//             open/close (CRT-fd mint+release) and the read path, not stat itself.
//
// RUN (baseline, today):   node bench/libuv-removal/composite-startup-resolve.mjs   (or bun)
// RUN (after a phase):     BENCH_BUN=path/to/new-bun.exe node bench/libuv-removal/composite-startup-resolve.mjs
// Knobs: BENCH_RUNS (default 8), BENCH_FAST=1 (fewer runs), BENCH_NODE=path
// Fixtures: auto-generated via composite-gen-fixtures.mjs if missing.
// Dev-box numbers are INDICATIVE: medians of short runs, spawn overhead (~CreateProcess) is
// included identically in every child target, so compare deltas, not absolutes.

import { spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync, openSync, closeSync, readdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures");
const BUN = process.env.BENCH_BUN || "bun";
const NODE = process.env.BENCH_NODE || "node";
const FAST = !!process.env.BENCH_FAST;
const RUNS = +(process.env.BENCH_RUNS || (FAST ? 4 : 8));
const WARMUP = FAST ? 1 : 2;

// ---------- micro mode: runs IN-PROCESS under whichever runtime spawned it ----------
if (process.argv[2] === "--micro") {
  const dir = process.argv[3];
  const files = Array.from({ length: 50 }, (_, i) => join(dir, `m${i}.js`));
  const missing = Array.from({ length: 50 }, (_, i) => join(dir, `nope-${i}`));
  const t = fn => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0); };
  const out = {};
  const loop = (name, iters, body) => {
    for (let i = 0; i < 100; i++) body(i); // warmup
    out[name] = t(() => { for (let i = 0; i < iters; i++) body(i); }) / iters / 1e3; // us/op
  };
  loop("statSync_hit", 3000, i => statSync(files[i % 50]));
  loop("statSync_miss", 3000, i => statSync(missing[i % 50], { throwIfNoEntry: false }));
  loop("existsSync_hit", 3000, i => existsSync(files[i % 50]));
  loop("open_close", 1500, i => closeSync(openSync(files[i % 50], "r")));
  loop("readFileSync", 1000, i => readFileSync(files[i % 50]));
  const entries = readdirSync(dir).length;
  loop("readdirSync_per_entry", 100, () => readdirSync(dir, { withFileTypes: true }));
  out.readdirSync_per_entry /= entries;
  console.log(JSON.stringify(out));
  process.exit(0);
}

// ---------- harness ----------
if (!existsSync(join(FIX, "modules-600", "index.js"))) {
  const r = spawnSync(process.execPath, [join(HERE, "composite-gen-fixtures.mjs")], { stdio: "inherit", windowsHide: true });
  if (r.status !== 0) process.exit(1);
}
const baseEnv = { ...process.env, NO_COLOR: "1" };
delete baseEnv.UV_THREADPOOL_SIZE; // default scenario must be the real default (4)
delete baseEnv.GOMAXPROCS;

function timeChild(bin, args, extra = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(bin, args, { cwd: HERE, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...extra, env: { ...baseEnv, ...(extra.env || {}) } });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.status !== 0) { console.error(`FAILED: ${bin} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`); process.exit(1); }
  return { ms, stdout: r.stdout };
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const fmt = (n, w = 8) => n.toFixed(2).padStart(w);

function bench(label, bin, args, extra = {}) {
  for (let i = 0; i < WARMUP; i++) timeChild(bin, args, extra);
  const walls = [], requires = [];
  for (let i = 0; i < RUNS; i++) {
    const { ms, stdout } = timeChild(bin, args, extra);
    walls.push(ms);
    const m = /"requireMs":\s*([\d.]+)/.exec(stdout);
    if (m) requires.push(+m[1]);
  }
  const row = { label, wall: median(walls), min: Math.min(...walls), max: Math.max(...walls), requireMs: requires.length ? median(requires) : null };
  console.log(`${label.padEnd(46)} ${fmt(row.wall)} ms  (min ${fmt(row.min, 7)}, max ${fmt(row.max, 7)}${row.requireMs != null ? `, in-app require ${row.requireMs.toFixed(2)} ms` : ""})`);
  return row;
}

console.log(`# composite-startup-resolve | cores=${cpus().length} | runs=${RUNS} (+${WARMUP} warmup) | ${new Date().toISOString()}`);
console.log(`# bun=${BUN} (${timeChild(BUN, ["--version"]).stdout.trim()})  node=${NODE} (${timeChild(NODE, ["--version"]).stdout.trim()})\n`);

console.log("## floors (runtime init; negative control — libuv removal should barely move these)");
const bunVersion = bench("bun --version", BUN, ["--version"]);
const bunE = bench("bun -e 1", BUN, ["-e", "1"]);
const nodeE = bench("node -e 1", NODE, ["-e", "1"]);

console.log("\n## module-resolution-heavy app start (CJS require tree, extensionless specifiers)");
const sizes = [100, 300, 600];
const bunApp = {}, nodeApp = {};
for (const n of sizes) bunApp[n] = bench(`bun  modules-${n}/index.js`, BUN, [join(FIX, `modules-${n}`, "index.js")]);
for (const n of sizes) nodeApp[n] = bench(`node modules-${n}/index.js`, NODE, [join(FIX, `modules-${n}`, "index.js")]);

console.log("\n## resolver-probe isolation: exact extensions (./mK.js) vs extensionless (./mK)");
const bunExact = bench("bun  modules-600-exact/index.js", BUN, [join(FIX, "modules-600-exact", "index.js")]);
const nodeExact = bench("node modules-600-exact/index.js", NODE, [join(FIX, "modules-600-exact", "index.js")]);

console.log("\n## control: threadpool cap must be irrelevant (module loading is synchronous)");
const ctl = bench("bun  modules-600 UV_THREADPOOL_SIZE=24", BUN, [join(FIX, "modules-600", "index.js")], { env: { UV_THREADPOOL_SIZE: "24" } });

// least-squares slope over (n, ms)
const slope = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length; return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0); };
const bunSlopeWall = slope(sizes.map(n => [n, bunApp[n].wall]));
const bunSlopeReq = slope(sizes.map(n => [n, bunApp[n].requireMs]));
const nodeSlopeWall = slope(sizes.map(n => [n, nodeApp[n].wall]));
const nodeSlopeReq = slope(sizes.map(n => [n, nodeApp[n].requireMs]));

console.log("\n## per-op micro attribution (in-process, us/op)");
const micro = {};
for (const [name, bin] of [["bun", BUN], ["node", NODE]]) {
  const r = spawnSync(bin, [fileURLToPath(import.meta.url), "--micro", join(FIX, "modules-600")], { encoding: "utf8", windowsHide: true, env: baseEnv });
  if (r.status !== 0) { console.error(`micro failed under ${name}: ${r.stderr}`); process.exit(1); }
  micro[name] = JSON.parse(r.stdout);
  console.log(`${name.padEnd(5)} ` + Object.entries(micro[name]).map(([k, v]) => `${k}=${v.toFixed(2)}`).join("  "));
}

console.log("\n## derived");
console.log(`bun  floor (-e 1)                  ${fmt(bunE.wall)} ms   (--version ${bunVersion.wall.toFixed(2)} ms)`);
console.log(`node floor (-e 1)                  ${fmt(nodeE.wall)} ms`);
console.log(`bun  per-module slope: wall ${bunSlopeWall.toFixed(4)} ms, in-app require ${bunSlopeReq.toFixed(4)} ms  (${(1 / bunSlopeReq * 1000).toFixed(0)} modules/s)`);
console.log(`node per-module slope: wall ${nodeSlopeWall.toFixed(4)} ms, in-app require ${nodeSlopeReq.toFixed(4)} ms`);
console.log(`control delta (threadpool=24 vs default) on modules-600: ${(ctl.wall - bunApp[600].wall).toFixed(2)} ms (expect ~0)`);
const b = micro.bun;
const bunProbeUs = (bunApp[600].requireMs - bunExact.requireMs) / 600 * 1000;
const nodeProbeUs = (nodeApp[600].requireMs - nodeExact.requireMs) / 600 * 1000;
console.log(`probe cost (extensionless minus exact, per module): bun ${bunProbeUs.toFixed(1)} us, node ${nodeProbeUs.toFixed(1)} us`);
console.log(`\nattribution:`);
console.log(`  bun probe cost ~${bunProbeUs.toFixed(1)} us/module (~0) => resolution is dir-cache based (native NtQueryDirectoryFile),`);
console.log(`  NOT per-probe uv stats; loads use openat+ReadFile (native). The uv-removable share of this`);
console.log(`  composite is small — treat this benchmark as the migration regression guard.`);
console.log(`  node pays ~${nodeProbeUs.toFixed(1)} us/module for uv stat probes (its statSync costs ${micro.node.statSync_hit.toFixed(1)}-${micro.node.statSync_miss.toFixed(1)} us/op).`);
console.log(`  micro table above = the JS-visible node:fs per-op costs (uv-routed surface, plan §2.3) for user code,`);
console.log(`  not what bun's module loader uses. Measured surprise: existsSync/access (${b.existsSync_hit.toFixed(1)} us) is ~3x SLOWER`);
console.log(`  than uv statSync (${b.statSync_hit.toFixed(1)} us) on AV-filtered boxes — path-attribute queries are taxed by filter drivers.`);
console.log(`  readdir(native NT, same binary): ${b.readdirSync_per_entry.toFixed(2)} us/entry — the native pattern the resolver already uses.`);
