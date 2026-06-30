// fswatch-burst.mjs — fs.watch event delivery on Windows: burst loss + latency
//
// CLAIM: fs.watch on Windows silently LOSES most events during a file-creation
// burst today; the native ReadDirectoryChangesW rewrite (64KB buffer) delivers
// them. Measured as "unique filenames observed / files created".
//
// MECHANISM (refs: LIBUV_WINDOWS_REMOVAL_PLAN.md §2.2 fs.watch, Phase 2.6, §3
// scorecard "fs events"; libuv worktree C:/Users/dylan/code/libuv-read):
//   * libuv posts ReadDirectoryChangesW with a fixed 4096-byte buffer
//     (win/fs-event.c:33 uv_directory_watcher_buffer_size). The FIRST RDCW call
//     fixes the size of the KERNEL-side notification buffer for the watch.
//   * When events accumulate faster than the loop re-arms (e.g. the JS thread is
//     busy, or a tool writes many files), the 4KB kernel buffer overflows; the
//     kernel discards ALL buffered notifications and the next completion returns
//     0 bytes. libuv then reports filename=NULL (win/fs-event.c:577).
//   * Bun's watcher DROPS that NULL notification entirely — no rescan, no event
//     (src/runtime/node/win_watcher.rs:237-244 `else { return; }`). Node at least
//     emits a 'change' with filename=null. Either way the per-file events are
//     unrecoverable.
//   * Each delivered event also costs 2x GetLongPathNameW probes + 2 mallocs
//     in libuv's parse loop (win/fs-event.c:497-521) before reaching JS.
//   * Native plan: direct RDCW + IOCP with a 64KB buffer (plan Phase 2.6) — a
//     1000-file burst of short names fits in one kernel buffer (~40 bytes/entry).
//
// RUN:
//   bun  bench/libuv-removal/fswatch-burst.mjs
//   node bench/libuv-removal/fswatch-burst.mjs     # same libuv → similar loss
//
// BEFORE/AFTER (measured on a 24-core Win11 box, bun 1.4.0 / node 25.8.1):
//   today  — blocked-loop burst: 0.1-0.2% delivered (1 file!), zero overflow
//            signal under bun (node at least emits one null event);
//            child-process burst: bun 10-30% delivered vs node 25-67% — bun's
//            per-batch dispatch loses the re-arm race ~2-5x harder than node
//            on the SAME libuv, so the rewrite has two stacked wins here.
//   after  — Phase 2.6 (64KB RDCW + overflow→rescan): ~100% at n=500 (fits with
//            headroom), ~100% at n=1000 (boundary: ~2 entries/file x 32B), and
//            any residual overflow must surface as a rescan event, not silence.
// latencyUs (single-touch delivery latency) is reported for completeness; it is
// loop-wakeup-bound (~1.3-1.7ms in both runtimes) and is NOT expected to move
// much — do not tweet that one.

import { watch, writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const isBun = typeof Bun !== "undefined";
const runtime = isBun ? `bun ${Bun.version}` : `node ${process.versions.node}`;
const hrt = () => process.hrtime.bigint();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- child mode
// Creates N files in DIR as fast as possible, then exits.
if (process.argv[2] === "burst-child") {
  const dir = process.argv[3];
  const n = +process.argv[4];
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `c${String(i).padStart(4, "0")}.txt`), "");
  }
  process.exit(0);
}

// 500 short names (≈2 notify entries/file, ~32B each) fit a 64KB buffer with
// headroom; 1000 sits at the 64KB boundary — both reported so the after-build
// shows an unambiguous 100% at 500 even if 1000 still clips.
const NS = process.argv.find(a => a.startsWith("--n="))
  ? [+process.argv.find(a => a.startsWith("--n=")).slice(4)]
  : [500, 1000];
const results = [];

function makeDir(tag) {
  return mkdtempSync(join(tmpdir(), `bun-fswatch-${tag}-`));
}

// Collect watcher events until `quietMs` passes with no new event (cap `maxMs`).
function collectEvents(dir) {
  const state = { names: new Set(), total: 0, nulls: 0, last: hrt(), watcher: null };
  state.watcher = watch(dir, (event, filename) => {
    state.total++;
    state.last = hrt();
    if (filename == null) state.nulls++;
    else state.names.add(String(filename));
  });
  return state;
}

async function settle(state, quietMs = 500, maxMs = 8000) {
  const t0 = hrt();
  for (;;) {
    await sleep(50);
    const sinceLast = Number(hrt() - state.last) / 1e6;
    const total = Number(hrt() - t0) / 1e6;
    if (sinceLast >= quietMs || total >= maxMs) break;
  }
  state.watcher.close();
}

// Phase 1: single-touch delivery latency (median; NOT expected to move much).
{
  const dir = makeDir("lat");
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const file = `lat${i}.txt`;
    let t0;
    const got = new Promise(resolve => {
      const w = watch(dir, (event, filename) => {
        if (String(filename) === file) { w.close(); resolve(hrt()); }
      });
      // Give the watcher a beat to arm before touching.
      setTimeout(() => { t0 = hrt(); writeFileSync(join(dir, file), "x"); }, 5);
    });
    const t1 = await Promise.race([got, sleep(2000).then(() => null)]);
    if (t1 !== null) samples.push(Number(t1 - t0) / 1000);
    await sleep(10);
  }
  samples.sort((a, b) => a - b);
  results.push({
    runtime, phase: "single-touch-latency",
    samples: samples.length,
    latencyUsMedian: +samples[samples.length >> 1].toFixed(0),
    latencyUsP90: +samples[Math.floor(samples.length * 0.9)].toFixed(0),
  });
  rmSync(dir, { recursive: true, force: true });
}

for (const N of NS) {
  // Phase 2: burst while the JS thread is BLOCKED (sync create loop in-process).
  // Kernel must buffer everything in libuv's 4KB → massive loss today.
  {
    const dir = makeDir("blocked");
    const state = collectEvents(dir);
    await sleep(100); // let the watcher arm
    const t0 = hrt();
    for (let i = 0; i < N; i++) {
      writeFileSync(join(dir, `b${String(i).padStart(4, "0")}.txt`), "");
    }
    const createMs = Number(hrt() - t0) / 1e6;
    await settle(state);
    results.push({
      runtime, phase: "burst-blocked-loop", created: N,
      createMs: +createMs.toFixed(0),
      uniqueFilesSeen: state.names.size,
      deliveredPct: +((state.names.size / N) * 100).toFixed(1),
      totalEvents: state.total,
      nullOverflowEvents: state.nulls,
    });
    rmSync(dir, { recursive: true, force: true });
  }

  // Phase 3: burst from a CHILD process — parent loop is free to re-arm, so this
  // measures the re-arm race (parse cost incl. GetLongPathNameW + JS dispatch vs
  // incoming event rate).
  {
    const dir = makeDir("child");
    const state = collectEvents(dir);
    await sleep(100);
    const child = spawn(process.execPath, [process.argv[1], "burst-child", dir, String(N)], {
      stdio: "ignore", windowsHide: true,
    });
    await new Promise((res, rej) => { child.on("error", rej); child.on("close", res); });
    await settle(state);
    results.push({
      runtime, phase: "burst-child-process", created: N,
      uniqueFilesSeen: state.names.size,
      deliveredPct: +((state.names.size / N) * 100).toFixed(1),
      totalEvents: state.total,
      nullOverflowEvents: state.nulls,
    });
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const r of results) console.error(JSON.stringify(r));
