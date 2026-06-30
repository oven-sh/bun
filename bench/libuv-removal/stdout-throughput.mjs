// stdout-throughput.mjs — console.log / process.stdout.write throughput on Windows
//
// CLAIM: When stdout is a PIPE (CI, `bun x | tee`, spawned tooling) or a FILE
// (`bun x > log.txt`), replacing libuv's write layers with direct blocking
// WriteFile makes per-line stdout writes faster — short-line lines/sec is the
// headline number.
//
// MECHANISM (today, libuv; refs into LIBUV_WINDOWS_REMOVAL_PLAN.md §2.2/§2.3 and
// the libuv worktree at C:/Users/dylan/code/libuv-read):
//   * console.log → Rust ConsoleObject 4KB buffered writer, flushed once per call
//     (src/jsc/ConsoleObject.rs FlushGuard) → bun.sys write on uv-kind fd 1 →
//     sys_uv.rs → synchronous uv_fs_write: per call = CRT fd→HANDLE lookup +
//     uv_fs_t setup + WriteFile + UV errno translation.
//   * process.stdout.write → FileSink → WindowsStreamingWriter (src/io/PipeWriter.rs)
//     → uv_write on a pipe with uv_stream_set_blocking(1)
//     (Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio,
//     src/runtime/webcore/FileSink.rs:247-289). In libuv, EVERY blocking pipe
//     write allocates a kernel event object: CreateEvent at win/pipe.c:1621,
//     CloseHandle at win/pipe.c:2213, and the spawned child's stdout pipe end is
//     non-overlapped, so the write is a plain WriteFile + a
//     PostQueuedCompletionStatus + a next-uv_run-tick completion dispatch
//     (win/pipe.c:1646-1666) before the JS callback resolves. Native plan keeps
//     the blocking WriteFile and deletes the event-object churn, the IOCP
//     round-trip, and the double-buffer queue (plan Phase 3.3).
//
// RUN (each takes ~10-20s):
//   bun  bench/libuv-removal/stdout-throughput.mjs            # before/after Bun
//   node bench/libuv-removal/stdout-throughput.mjs            # libuv reference
//   bun  bench/libuv-removal/stdout-throughput.mjs --target=file
// In a real Windows Terminal, `--target=tty` runs the same patterns against the
// console (uv_tty + global lock + WriteConsoleW path) without spawning.
//
// BEFORE/AFTER: run with the shipping (libuv) bun, save output; run again with a
// post-migration build (Phase 3.3 for pipes, Phase 2.4 for console.log/file).
// Lines/sec for 64B lines is the number to compare. node output is a sanity
// reference (same libuv underneath, different JS stream layer).
//
// HOW TO READ IT (attribution anchors, measured on a 24-core Win11 box):
//   * sync-write vs sync-writesync (64B) is the SAME-BINARY control: writesync
//     is a per-call blocking write with no stream handle/queue/loop round-trip,
//     i.e. approximately the native end-state shape. The gap (~25-35% today) is
//     the deletable streaming layer. sync-write-buf rules out string-encode cost.
//   * 4096B rows are kernel-copy-bound (all paths converge ~600-900 MB/s) and
//     are NOT expected to move — they are the negative control.
//   * --target=file: all bun paths converge on the shared sync write syscall
//     (~390k lines/s) — file-redirect gains, if any, come from replacing
//     uv_fs_write's CRT-fd path with WriteFile-on-HANDLE, not from the JS layer.

import { spawn } from "node:child_process";
import { openSync, closeSync, unlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isBun = typeof Bun !== "undefined";
const runtime = isBun ? `bun ${Bun.version}` : `node ${process.versions.node}`;
const hrt = () => process.hrtime.bigint();

// ---------------------------------------------------------------- child mode
if (process.argv[2] === "child") {
  const pattern = process.argv[3];
  const size = +process.argv[4];
  const n = +process.argv[5];
  const line = Buffer.alloc(size - 1, "x").toString();
  const lineNl = line + "\n";

  const t0 = hrt();
  if (pattern === "sync-console") {
    for (let i = 0; i < n; i++) console.log(line);
  } else if (pattern === "sync-write") {
    for (let i = 0; i < n; i++) process.stdout.write(lineNl);
  } else if (pattern === "cb-write") {
    for (let i = 0; i < n; i++) {
      await new Promise(r => process.stdout.write(lineNl, r));
    }
  } else if (pattern === "sync-write-buf") {
    // Same as sync-write but with a Buffer payload, so the delta vs
    // sync-writesync isolates the stream/queue layer (no string-encode skew).
    const buf = Buffer.from(lineNl);
    for (let i = 0; i < n; i++) process.stdout.write(buf);
  } else if (pattern === "sync-writesync") {
    // Control: per-call BLOCKING write through the sync uv_fs_write path
    // (sys_uv.rs on bun). No stream handle, no queue, no loop round-trip —
    // this approximates the native end-state's per-write cost ceiling.
    const { writeSync } = await import("node:fs");
    const buf = Buffer.from(lineNl);
    for (let i = 0; i < n; i++) writeSync(1, buf);
  } else {
    throw new Error("unknown pattern " + pattern);
  }
  // Force a full drain so loopNs covers "time until all N lines are emitted".
  await new Promise(r => process.stdout.write("\n", r));
  const t1 = hrt();
  process.stderr.write(JSON.stringify({ loopNs: Number(t1 - t0) }) + "\n");
  process.exit(0);
}

// --------------------------------------------------------------- parent mode
const target = (process.argv.find(a => a.startsWith("--target=")) || "--target=pipe").slice(9);
const REPEATS = 5;

// pattern, lineBytes, count — short-line counts give a ~0.3-0.6s steady-state
// window per repeat; shorter windows are scheduling-noise-dominated on a dev box.
const CONFIGS = [
  ["sync-console", 64, 300_000],
  ["sync-write", 64, 300_000],
  ["sync-write-buf", 64, 300_000],
  ["sync-writesync", 64, 300_000],
  ["cb-write", 64, 50_000],
  ["sync-console", 4096, 20_000],
  ["sync-write", 4096, 20_000],
  ["sync-writesync", 4096, 20_000],
];

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

async function runOnce(pattern, size, n) {
  const args = [process.argv[1], "child", pattern, String(size), String(n)];
  let outFd = null, outPath = null;
  let stdio;
  if (target === "file") {
    outPath = join(tmpdir(), `bun-stdout-bench-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
    outFd = openSync(outPath, "w");
    stdio = ["ignore", outFd, "pipe"];
  } else {
    stdio = ["ignore", "pipe", "pipe"];
  }

  const wall0 = hrt();
  const child = spawn(process.execPath, args, { stdio, windowsHide: true });
  let bytes = 0;
  if (target === "pipe") child.stdout.on("data", c => (bytes += c.length));
  let errBuf = "";
  child.stderr.on("data", c => (errBuf += c));
  const code = await new Promise((res, rej) => {
    child.on("error", rej);
    child.on("close", res);
  });
  const wallNs = Number(hrt() - wall0);
  if (outFd !== null) {
    bytes = statSync(outPath).size;
    closeSync(outFd);
    unlinkSync(outPath);
  }
  if (code !== 0) throw new Error(`child exited ${code}: ${errBuf}`);
  const { loopNs } = JSON.parse(errBuf.trim().split("\n").pop());
  return { loopNs, wallNs, bytes };
}

if (target === "tty") {
  // Manual mode: run the patterns inline against the real console.
  if (!process.stdout.isTTY) {
    console.error("--target=tty requires a real console (stdout.isTTY is false)");
    process.exit(1);
  }
  for (const [pattern, size, n] of CONFIGS) {
    const line = Buffer.alloc(size - 1, "x").toString();
    const lineNl = line + "\n";
    const t0 = hrt();
    if (pattern === "sync-console") for (let i = 0; i < n; i++) console.log(line);
    else if (pattern === "sync-write") for (let i = 0; i < n; i++) process.stdout.write(lineNl);
    else for (let i = 0; i < n; i++) await new Promise(r => process.stdout.write(lineNl, r));
    await new Promise(r => process.stdout.write("\n", r));
    const ns = Number(hrt() - t0);
    process.stderr.write(`TTY ${pattern} ${size}B x${n}: ${((n / ns) * 1e9).toFixed(0)} lines/s\n`);
  }
  process.exit(0);
}

console.error(`# stdout-throughput target=${target} runtime=${runtime} (median of ${REPEATS})`);
const results = [];
for (const [pattern, size, n] of CONFIGS) {
  await runOnce(pattern, size, n); // warmup
  const reps = [];
  for (let r = 0; r < REPEATS; r++) reps.push(await runOnce(pattern, size, n));
  const expect = size * n + 1; // each line is `size` bytes incl. its "\n"; +1 = final drain marker
  const linesPerSec = reps.map(x => (n / x.loopNs) * 1e9);
  const mbPerSec = reps.map(x => (x.bytes / (x.loopNs / 1e9)) / (1024 * 1024));
  const row = {
    target, runtime, pattern, lineBytes: size, count: n,
    linesPerSec: Math.round(median(linesPerSec)),
    linesPerSecMin: Math.round(Math.min(...linesPerSec)),
    linesPerSecMax: Math.round(Math.max(...linesPerSec)),
    MBps: +median(mbPerSec).toFixed(1),
    loopMsMedian: +(median(reps.map(x => x.loopNs)) / 1e6).toFixed(1),
    spawnOverheadMs: +((median(reps.map(x => x.wallNs)) - median(reps.map(x => x.loopNs))) / 1e6).toFixed(0),
    bytes: reps[0].bytes, bytesExpectedAtLeast: expect,
  };
  results.push(row);
  console.error(
    `${pattern.padEnd(13)} ${String(size).padStart(4)}B x${String(n).padEnd(6)} ` +
    `${String(row.linesPerSec).padStart(8)} lines/s  ${String(row.MBps).padStart(7)} MB/s  ` +
    `(min ${row.linesPerSecMin}, max ${row.linesPerSecMax}, loop ${row.loopMsMedian}ms)`
  );
}
console.error("\nJSON:");
console.error(JSON.stringify(results));
