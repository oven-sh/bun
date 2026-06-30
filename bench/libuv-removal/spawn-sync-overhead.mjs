// spawn-sync-overhead.mjs — Bun-only. Same-binary attribution of Windows spawn overhead.
//
// CLAIM UNDER TEST
//   "Bun.spawnSync carries removable libuv-layer overhead per spawn." This script
//   measures that overhead DIRECTLY, in the same bun.exe process, by comparing
//   Bun.spawnSync against raw kernel32 via bun:ffi:
//     ffi-min      : CreateProcessW + WaitForSingleObject + CloseHandle, no handles,
//                    no job — the absolute kernel floor for this child.
//     ffi-nul+job  : + cached inheritable NUL handle as stdin/stdout/stderr
//                    (STARTF_USESTDHANDLES) + AssignProcessToJobObject on a
//                    kill-on-close job. This models the POST-MIGRATION native
//                    'ignore' spawn (plan Phase 3.2: native CreateProcessW, cached
//                    NUL, kill-on-close job object kept).
//     bun ignore / pipe2 / pipe3 / inherit : Bun.spawnSync today (libuv uv_spawn).
//
// MECHANISM (what the deltas attribute, with sources)
//   bun-ignore − ffi-nul+job = TODAY's removable layer cost for ignore-mode spawns:
//     * 3× fresh CreateFileW("NUL") per spawn (libuv process-stdio.c:210-230 — the
//       native design caches one NUL handle for the process lifetime)
//     * make_program_env: env UTF-16 conversion + qsort per spawn even when env is
//       unmodified (process.c:945, env.c make_program_env; native can pass
//       lpEnvironment=NULL to inherit), make_program_args, cwd fetch, search_path
//       GetFileAttributesW probes (process.c:933-1023)
//     * RegisterWaitForSingleObject exit watch -> PostQueuedCompletionStatus ->
//       isolated uv loop pump (src/event_loop/SpawnSyncEventLoop.rs; loop object
//       itself is cached in RareData, NOT per-call) + uv handle endgame closes
//     * Bun's JS option parsing / result building (NOT removable — stays after
//       migration; this makes the delta an UPPER bound on the libuv share)
//   bun-pipeN − bun-ignore = the libuv pipe-pair tax for N piped stdio fds:
//     CreateNamedPipeA (collision-retry loop) + CreateFileA + blocking
//     ConnectNamedPipe per pipe (libuv pipe.c:209-346, process-stdio.c:232-255)
//     plus uv_pipe handle lifecycle (read_start, EOF, deferred uv_close endgame).
//     Plan Phase 3.2/3.3 can pre-create/pool overlapped pipe pairs and use W APIs.
//
// MEASURED TODAY (Windows 11, 24-core dev box, bun 1.4.0):
//   bun-ignore − ffi-nul+job ≈ +0.13..+0.47 ms across sessions (~3-5% of a
//     null-child spawn; ~0% of real children like cmd.exe at 13-20 ms)
//   bun-pipe2/3 − bun-ignore  brackets ZERO across sessions (−0.2..+0.1 ms) —
//     the pipe-pair tax is below this machine's noise floor
//   The absolute floor itself swung 3.7..9.5 ms between sessions (Defender /
//   power state) while paired deltas stayed in-band: ONLY the paired deltas
//   from a single run are meaningful; never compare absolutes across runs.
//   Spawn cost is dominated by CreateProcessW (~1.3 ms) + child lifetime —
//   kernel-inherent. EXPECT SMALL MOVES, and use this script as the regression
//   guardrail when Phase 3.2 lands: pipe rows must converge toward ignore, ignore
//   toward ffi-nul+job, and NOTHING may get slower.
//
// METHOD
//   Interleaved rounds (one spawn of every variant per round) so machine drift
//   (Defender, power states) cancels in PAIRED per-round deltas; medians of
//   deltas, 5 repeats, spread reported. Numbers are INDICATIVE, not lab-grade.
//
// RUN
//   before:  bun bench/libuv-removal/spawn-sync-overhead.mjs        (libuv build)
//   after :  re-run with the native-spawn build, same machine, compare tables.
//   Requires clang or zig in PATH on first run (compiles nullchild.exe once).

import { dlopen, FFIType, ptr } from "bun:ffi";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (typeof Bun === "undefined") {
  console.error("bun-only (uses bun:ffi). Run: bun spawn-sync-overhead.mjs");
  process.exit(1);
}
if (process.platform !== "win32") {
  console.error("Windows-only benchmark.");
  process.exit(1);
}

// ---------------------------------------------------------------- child setup
const DIR = fileURLToPath(new URL(".", import.meta.url));
const CHILD = DIR + "nullchild.exe";
if (!existsSync(CHILD)) {
  let built = false;
  for (const cc of [["clang", "-O2"], ["zig", "cc", "-O2"]]) {
    const r = Bun.spawnSync({
      cmd: [...cc, DIR + "nullchild.c", "-o", CHILD],
      stdout: "ignore", stderr: "ignore",
    });
    if (r.exitCode === 0) { built = true; break; }
  }
  if (!built) {
    console.error("could not build nullchild.exe (need clang or zig in PATH)");
    process.exit(1);
  }
}

// ---------------------------------------------------------------- ffi control
const K32 = dlopen("kernel32.dll", {
  CreateProcessW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  WaitForSingleObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  GetExitCodeProcess: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  SetInformationJobObject: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  AssignProcessToJobObject: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.ptr },
  GetLastError: { args: [], returns: FFIType.u32 },
}).symbols;

const wstr = s => {
  const a = new Uint16Array(s.length + 1);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
};

// One-time: kill-on-close + silent-breakaway job object (mirrors libuv's global
// job, process.c:69-120 — per-spawn cost mirrored below is AssignProcessToJobObject).
const jobInfo = new Uint8Array(144); // JOBOBJECT_EXTENDED_LIMIT_INFORMATION, x64
new DataView(jobInfo.buffer).setUint32(16, 0x2000 | 0x1000, true); // KILL_ON_JOB_CLOSE|SILENT_BREAKAWAY_OK
const job = K32.CreateJobObjectW(null, null);
if (!job) throw new Error("CreateJobObjectW: " + K32.GetLastError());
if (!K32.SetInformationJobObject(job, 9 /*ExtendedLimitInformation*/, ptr(jobInfo), 144))
  throw new Error("SetInformationJobObject: " + K32.GetLastError());

// One-time: cached inheritable NUL handle (the native-design replacement for
// libuv's per-spawn NUL opens).
const sa = new Uint8Array(24); // SECURITY_ATTRIBUTES
new DataView(sa.buffer).setUint32(0, 24, true);
new DataView(sa.buffer).setUint32(16, 1, true); // bInheritHandle
const nulHandle = K32.CreateFileW(ptr(wstr("NUL")), 0xC0000000 >>> 0 /*GENERIC_READ|WRITE*/, 3, ptr(sa), 3 /*OPEN_EXISTING*/, 0, null);
if (!nulHandle) throw new Error("CreateFileW NUL: " + K32.GetLastError());

const appName = wstr(CHILD);
const cmdSrc = wstr(`"${CHILD}"`); // CreateProcessW may scribble on lpCommandLine
const cmdBuf = new Uint16Array(cmdSrc.length);
const si = new Uint8Array(104), pi = new Uint8Array(24); // STARTUPINFOW / PROCESS_INFORMATION
const siDV = new DataView(si.buffer), piDV = new DataView(pi.buffer);
const exitBuf = new Uint8Array(4), exitDV = new DataView(exitBuf.buffer);

function ffiSpawn(useStdHandles, assignJob) {
  si.fill(0);
  siDV.setUint32(0, 104, true); // cb
  if (useStdHandles) {
    siDV.setUint32(60, 0x100 | 0x1, true); // STARTF_USESTDHANDLES|STARTF_USESHOWWINDOW
    siDV.setUint16(64, 10, true); // SW_SHOWDEFAULT (Bun's JS default is windowsHide:false)
    siDV.setBigUint64(80, BigInt(nulHandle), true);
    siDV.setBigUint64(88, BigInt(nulHandle), true);
    siDV.setBigUint64(96, BigInt(nulHandle), true);
  }
  cmdBuf.set(cmdSrc);
  // lpEnvironment=NULL (inherit parent env directly — no per-spawn env block build),
  // lpCurrentDirectory=NULL (inherit cwd).
  if (!K32.CreateProcessW(ptr(appName), ptr(cmdBuf), null, null, useStdHandles ? 1 : 0, 0, null, null, ptr(si), ptr(pi)))
    throw new Error("CreateProcessW: " + K32.GetLastError());
  const hProcess = Number(piDV.getBigUint64(0, true));
  const hThread = Number(piDV.getBigUint64(8, true));
  if (assignJob) K32.AssignProcessToJobObject(job, hProcess); // ACCESS_DENIED swallowed, like libuv
  if (K32.WaitForSingleObject(hProcess, 60_000) !== 0) throw new Error("wait failed");
  K32.GetExitCodeProcess(hProcess, ptr(exitBuf));
  K32.CloseHandle(hThread);
  K32.CloseHandle(hProcess);
  if (exitDV.getUint32(0, true) !== 0) throw new Error("child exit != 0");
}

// ---------------------------------------------------------------- bun variants
const bunSpawn = (stdin, stdout, stderr) => () => {
  const r = Bun.spawnSync({ cmd: [CHILD], stdin, stdout, stderr });
  if (r.exitCode !== 0) throw new Error("child exit " + r.exitCode);
};

const VARIANTS = {
  "ffi-min": () => ffiSpawn(false, false),
  "ffi-nul+job": () => ffiSpawn(true, true),
  "bun-ignore": bunSpawn("ignore", "ignore", "ignore"),
  "bun-pipe2": bunSpawn("ignore", "pipe", "pipe"),
  "bun-pipe3": bunSpawn("pipe", "pipe", "pipe"),
  "bun-inherit": bunSpawn("inherit", "inherit", "inherit"),
};
// paired deltas to report: [minuend, subtrahend, meaning]
const PAIRS = [
  ["bun-ignore", "ffi-nul+job", "layer overhead vs native-'ignore' model (upper bound on libuv share)"],
  ["bun-ignore", "ffi-min", "layer overhead vs bare kernel floor"],
  ["bun-pipe2", "bun-ignore", "libuv pipe-pair tax, 2 pipes (stdout+stderr)"],
  ["bun-pipe3", "bun-ignore", "libuv pipe-pair tax, 3 pipes"],
  ["ffi-nul+job", "ffi-min", "cost of 3 std handles + job assign (kernel, NOT removable)"],
];

// ---------------------------------------------------------------- measurement
const ROUNDS = 30, REPEATS = 5, WARMUP = 5;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const keys = Object.keys(VARIANTS);

for (const k of keys) for (let i = 0; i < WARMUP; i++) VARIANTS[k]();

const repeatMedians = Object.fromEntries(keys.map(k => [k, []]));
const repeatDeltaMedians = PAIRS.map(() => []);
for (let rep = 0; rep < REPEATS; rep++) {
  const samples = Object.fromEntries(keys.map(k => [k, []]));
  for (let r = 0; r < ROUNDS; r++) {
    for (const k of keys) {
      const t0 = Bun.nanoseconds();
      VARIANTS[k]();
      samples[k].push((Bun.nanoseconds() - t0) / 1e6);
    }
  }
  for (const k of keys) repeatMedians[k].push(med(samples[k]));
  PAIRS.forEach(([a, b], i) => {
    repeatDeltaMedians[i].push(med(samples[a].map((v, j) => v - samples[b][j])));
  });
}

console.log(`child: ${CHILD}`);
console.log(`rounds=${ROUNDS} repeats=${REPEATS} (interleaved; paired per-round deltas)\n`);
console.log("absolute per-spawn time (median of per-repeat medians; min..max across repeats):");
for (const k of keys) {
  const m = repeatMedians[k];
  console.log(`  ${k.padEnd(12)} ${med(m).toFixed(3)} ms   [${Math.min(...m).toFixed(3)} .. ${Math.max(...m).toFixed(3)}]`);
}
console.log("\npaired deltas (median-of-per-round-deltas per repeat; min..max across repeats):");
PAIRS.forEach(([a, b, label], i) => {
  const m = repeatDeltaMedians[i];
  console.log(`  ${(a + " - " + b).padEnd(26)} ${med(m) >= 0 ? "+" : ""}${med(m).toFixed(3)} ms   [${Math.min(...m).toFixed(3)} .. ${Math.max(...m).toFixed(3)}]  ${label}`);
});
console.log("\nreading: after the native-spawn migration, 'bun-pipeN - bun-ignore' should go to ~0");
console.log("(pooled pipe pairs) and 'bun-ignore - ffi-nul+job' should shrink; the ~ms absolute");
console.log("floor (ffi rows) is CreateProcessW + child lifetime and will NOT move.");
