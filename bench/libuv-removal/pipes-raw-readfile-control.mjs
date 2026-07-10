// pipes-raw-readfile-control.mjs — ATTRIBUTION CONTROL for pipes-stdout-throughput.mjs.
// Bun-only (bun:ffi). Not a before/after demonstrator — a same-machine ceiling probe.
//
// WHAT IT MEASURES: the same child writer as pipes-stdout-throughput.mjs (fs.writeSync
// of 64KB chunks), but the parent consumes the pipe with raw blocking ReadFile calls via
// bun:ffi — exactly ONE syscall per chunk, no event loop, no libuv, no stream layer.
// This is the kernel+copy cost floor for moving bytes through a Windows pipe.
//
//   removable overhead bound = (this script's MB/s & CPU) vs
//                              (pipes-stdout-throughput.mjs bun numbers, 64KB row)
//
// The gap contains: libuv's zero-read + PeekNamedPipe + IOCP roundtrips per cycle
// (libuv-read src/win/pipe.c:1400-1458, 1968-2047 — see the throughput script header),
// plus Bun's stream/JS delivery layer. A native reader (plan the removal) cannot reach
// this floor (it keeps the event loop and stream delivery) but closes the syscall part
// of the gap: ~3-4 pipe syscalls per 64KB today -> 1-2.
//
// Also runs a 1MB-read variant: libuv caps every pipe read at 65536 bytes
// (pipe.c:2175 bytes_requested = 65536); a native reader picks its own buffer size, so
// the 1MB-read row shows what lifting the 64KB cap is worth at the kernel level.
//
// RUN:  bun bench/libuv-removal/pipes-raw-readfile-control.mjs   [--json] [--quick]

import { dlopen, FFIType, ptr } from "bun:ffi";

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const QUICK = flag("--quick");
const JSON_OUT = flag("--json");
const REPEATS = QUICK ? 2 : 5;
const TARGET_SECS = 0.8;
const CHILD_WRITE = 65536;
const READ_SIZES = [65536, 1048576];
const MIN_TOTAL = 64 * 1024 * 1024;
const MAX_TOTAL = 4096 * 1024 * 1024;

const k32 = dlopen("kernel32.dll", {
  CreateNamedPipeW: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr],
    returns: FFIType.ptr,
  },
  ConnectNamedPipe: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  ReadFile: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  GetLastError: { args: [], returns: FFIType.u32 },
}).symbols;

const PIPE_ACCESS_DUPLEX = 0x3;
const PIPE_BYTE_WAIT = 0x0; // PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT
const ERROR_PIPE_CONNECTED = 535;
const INVALID_HANDLE = -1;

function hr() {
  return process.hrtime.bigint();
}
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return { median, min: s[0], max: s[s.length - 1], sd, n: s.length };
}

let pipeSeq = 0;
function childCode(pipePath, total) {
  // identical write pattern to pipes-stdout-throughput.mjs, targeted at the named pipe
  return (
    `const fs=require('fs');` +
    `const fd=fs.openSync(${JSON.stringify(pipePath)},'r+');` +
    `const size=${CHILD_WRITE},total=${total};` +
    `const buf=Buffer.alloc(size,65);let left=total;` +
    `while(left>0){const n=Math.min(left,size);let off=0;` +
    `while(off<n){off+=fs.writeSync(fd,buf,off,n-off);}left-=n;}` +
    `fs.closeSync(fd);`
  );
}

async function runOnce(readSize, total) {
  const name = `\\\\.\\pipe\\bun-libuv-bench-${process.pid}-${pipeSeq++}`;
  const wname = Buffer.from(name + "\0", "utf16le");
  const h = k32.CreateNamedPipeW(ptr(wname), PIPE_ACCESS_DUPLEX, PIPE_BYTE_WAIT, 1, 65536, 65536, 0, null);
  if (h === null || Number(h) === INVALID_HANDLE) {
    throw new Error(`CreateNamedPipeW failed: ${k32.GetLastError()}`);
  }

  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", childCode(name, total)],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "inherit",
  });

  // blocking connect; FALSE + ERROR_PIPE_CONNECTED means the child won the race
  if (!k32.ConnectNamedPipe(h, null)) {
    const e = k32.GetLastError();
    if (e !== ERROR_PIPE_CONNECTED) {
      k32.CloseHandle(h);
      throw new Error(`ConnectNamedPipe failed: ${e}`);
    }
  }

  const buf = Buffer.alloc(readSize);
  const nRead = Buffer.alloc(8);
  const cpu0 = process.cpuUsage();
  let received = 0;
  let t0 = 0n;
  for (;;) {
    // ptr() taken fresh each iteration: a cached ptr() can go stale across GC,
    // leaving the kernel writing the byte count to a dangling address.
    const ok = k32.ReadFile(h, ptr(buf), readSize, ptr(nRead), null);
    const n = nRead.readUInt32LE(0);
    if (!ok || n === 0) break; // broken pipe (child closed) == EOF
    if (received === 0) t0 = hr(); // clock starts at first byte, like the throughput script
    received += n;
  }
  const t1 = hr();
  const cpu = process.cpuUsage(cpu0);
  k32.CloseHandle(h);
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`child exited ${exitCode}`);
  if (received !== total) throw new Error(`received ${received}, expected ${total}`);

  const secs = Number(t1 - t0) / 1e9;
  return {
    mbps: received / 1e6 / secs,
    cpuMsPerGB: (cpu.user + cpu.system) / 1e3 / (received / 1e9),
  };
}

async function bench(readSize) {
  const cal = await runOnce(readSize, MIN_TOTAL); // warmup + calibration
  let total = Math.round((cal.mbps * 1e6 * TARGET_SECS) / CHILD_WRITE) * CHILD_WRITE;
  total = Math.max(MIN_TOTAL, Math.min(MAX_TOTAL, total));
  const runs = [];
  for (let i = 0; i < REPEATS; i++) runs.push(await runOnce(readSize, total));
  return {
    readSize,
    total,
    mbps: stats(runs.map(r => r.mbps)),
    cpuMsPerGB: stats(runs.map(r => r.cpuMsPerGB)),
  };
}

const header = {
  script: "pipes-raw-readfile-control",
  runtime: `bun ${Bun.version}`,
  childWrite: CHILD_WRITE,
  repeats: REPEATS,
  platform: `${process.platform} ${process.arch}`,
};

if (!JSON_OUT) {
  console.log(`# ${header.script}  runtime=${header.runtime}  child writes ${CHILD_WRITE / 1024}KB chunks`);
  console.log(`# raw blocking ReadFile loop — kernel+copy floor; compare to pipes-stdout-throughput bun rows`);
  console.log("readSize   total       MB/s median   min      max      sd     parentCPU ms/GB");
}

const results = [];
for (const rs of READ_SIZES) {
  const r = await bench(rs);
  results.push(r);
  if (!JSON_OUT) {
    const label = rs >= 1048576 ? `${rs / 1048576}MB` : `${rs / 1024}KB`;
    console.log(
      label.padEnd(11) +
        `${(r.total / 1048576).toFixed(0)}MB`.padEnd(12) +
        r.mbps.median.toFixed(1).padEnd(14) +
        r.mbps.min.toFixed(1).padEnd(9) +
        r.mbps.max.toFixed(1).padEnd(9) +
        r.mbps.sd.toFixed(1).padEnd(7) +
        r.cpuMsPerGB.median.toFixed(1),
    );
  }
}

if (JSON_OUT) console.log(JSON.stringify({ ...header, results }, null, 2));
