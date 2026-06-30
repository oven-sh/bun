// pipes-stdout-throughput.mjs — Windows subprocess stdout pipe throughput.
//
// CLAIM: after Bun's Windows pipe reader moves off libuv (LIBUV_WINDOWS_REMOVAL_PLAN.md
// Phase 3.3 "Pipe streams"), a Bun parent consuming a child's stdout gets higher MB/s
// and burns less parent CPU per GB — most visibly for small chunks (dev tools, test
// runners, build watchers streaming output). Today Bun and Node are ~at parity here:
// both pay the same libuv pipe-read tax.
//
// MECHANISM (what a native reader removes; refs into the libuv worktree src/win/pipe.c):
//   per drain cycle on an overlapped pipe:
//     1. 0-byte "zero read"   ReadFile(h, &uv_zero_, 0, ..)   pipe.c:1400-1458 (uv__pipe_queue_read)
//     2. IOCP dequeue of that empty completion               (uv_run)
//     3. per <=64KB chunk: alloc_cb + a second, quasi-sync
//        ReadFile into the user buffer                       pipe.c:1968-2047 (uv__pipe_read_data)
//     4. loop gate: oven-sh fork (shipped in bun.exe) does PeekNamedPipe per iteration
//        (ledger PIPE-32); upstream/node does a speculative ReadFile -> IO_PENDING ->
//        CancelIoEx -> GetOverlappedResult probe instead     pipe.c:2024-2046
//     5. eof timer arm/disarm per cycle                      pipe.c:1447,2147
//   => 3-4 pipe syscalls per 64KB chunk; only ONE moves data. The native reader posts a
//   real overlapped ReadFile into a preallocated buffer (1 syscall/chunk + dequeue) and
//   with FILE_SKIP_COMPLETION_PORT_ON_SUCCESS skips the IOCP roundtrip when data is
//   already buffered. Note: libuv's internal reads are capped at 65536 bytes per
//   ReadFile (pipe.c:2175 bytes_requested = 65536), so the 1MB row measures per-64KB
//   overhead too — the child-side write size only changes coalescing.
//
// RUN (same commands before and after the migration; the delta is the result):
//   bun  bench/libuv-removal/pipes-stdout-throughput.mjs          # Bun parent (measured path)
//   node bench/libuv-removal/pipes-stdout-throughput.mjs          # Node reference (same uv tax)
//   bun  ... --bun-api                                            # Bun.spawn + for-await proc.stdout
//   CHILD=node bun ...                                            # pin child runtime to isolate the parent
//   Flags: --json, --quick (2 repeats), --repeats=N, --target-secs=S
//
// Child writes via fs.writeSync(1, ...) — one blocking WriteFile per chunk in both
// runtimes, so the parent's read path dominates the comparison.

import { spawn } from "node:child_process";
import { once } from "node:events";

const IS_BUN = typeof Bun !== "undefined";
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => {
  const p = args.find(a => a.startsWith(n + "="));
  return p ? p.slice(n.length + 1) : d;
};
const QUICK = flag("--quick");
const REPEATS = Number(opt("--repeats", QUICK ? 2 : 5));
const TARGET_SECS = Number(opt("--target-secs", 0.8));
const USE_BUN_API = flag("--bun-api");
const JSON_OUT = flag("--json");

if (USE_BUN_API && !IS_BUN) {
  console.error("--bun-api requires running under bun");
  process.exit(1);
}

const CHILD =
  process.env.CHILD === "node" ? "node"
  : process.env.CHILD === "bun" ? "bun"
  : process.env.CHILD || process.execPath;

// 256B = line-streaming dev-tool story; 4K/64K/1M = the size sweep.
const SIZES = [256, 4096, 65536, 1048576];
const MIN_TOTAL = 16 * 1024 * 1024;
const MAX_TOTAL = 1536 * 1024 * 1024;

function childCode(size, total) {
  return (
    `const fs=require('fs');const size=${size},total=${total};` +
    `const buf=Buffer.alloc(size,65);let left=total;` +
    `while(left>0){const n=Math.min(left,size);let off=0;` +
    `while(off<n){off+=fs.writeSync(1,buf,off,n-off);}left-=n;}`
  );
}

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

async function runOnce(size, total) {
  const code = childCode(size, total);
  const cpu0 = process.cpuUsage();
  let t0 = 0n, t1 = 0n, counted = 0, first = true;

  if (USE_BUN_API) {
    const proc = Bun.spawn({
      cmd: [CHILD, "-e", code],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    for await (const chunk of proc.stdout) {
      if (first) {
        first = false;
        t0 = hr();
        continue; // first chunk's bytes excluded: clock starts at its arrival
      }
      counted += chunk.length;
    }
    t1 = hr();
    const code_ = await proc.exited;
    if (code_ !== 0) throw new Error(`child exited ${code_}`);
  } else {
    const child = spawn(CHILD, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
    const fail = new Promise((_, reject) => {
      child.on("error", reject);
    });
    const read = (async () => {
      for await (const chunk of child.stdout) {
        if (first) {
          first = false;
          t0 = hr();
          continue;
        }
        counted += chunk.length;
      }
      t1 = hr();
    })();
    await Promise.race([read, fail]);
    const [exitCode, sig] = child.exitCode !== null ? [child.exitCode, child.signalCode] : await once(child, "exit");
    if (exitCode !== 0) throw new Error(`child exited ${exitCode} ${sig ?? ""}`);
  }

  const cpu = process.cpuUsage(cpu0);
  const secs = Number(t1 - t0) / 1e9;
  if (counted < total * 0.25) throw new Error(`only counted ${counted} of ${total} bytes`);
  return {
    mbps: counted / 1e6 / secs,
    secs,
    counted,
    cpuMsPerGB: (cpu.user + cpu.system) / 1e3 / (counted / 1e9),
  };
}

async function bench(size) {
  // calibration run (also the warmup): pick a total that runs ~TARGET_SECS
  const calTotal = Math.max(MIN_TOTAL, size * 64);
  const cal = await runOnce(size, calTotal);
  let total = Math.round((cal.mbps * 1e6 * TARGET_SECS) / size) * size;
  total = Math.max(MIN_TOTAL, Math.min(MAX_TOTAL, total));

  const runs = [];
  for (let i = 0; i < REPEATS; i++) runs.push(await runOnce(size, total));
  return {
    size,
    total,
    mbps: stats(runs.map(r => r.mbps)),
    cpuMsPerGB: stats(runs.map(r => r.cpuMsPerGB)),
  };
}

const runtime = IS_BUN ? `bun ${Bun.version}` : `node ${process.versions.node}`;
const header = {
  script: "pipes-stdout-throughput",
  runtime,
  parentApi: USE_BUN_API ? "Bun.spawn" : "node:child_process.spawn",
  child: CHILD,
  repeats: REPEATS,
  platform: `${process.platform} ${process.arch}`,
};

if (!JSON_OUT) {
  console.log(`# ${header.script}  parent=${runtime}  api=${header.parentApi}  child=${CHILD}`);
  console.log(`# repeats=${REPEATS} target=${TARGET_SECS}s  (median over repeats; calibration run discarded)`);
  console.log("chunk      total       MB/s median   min      max      sd     parentCPU ms/GB");
}

const results = [];
for (const size of SIZES) {
  const r = await bench(size);
  results.push(r);
  if (!JSON_OUT) {
    const label = size >= 1048576 ? `${size / 1048576}MB` : size >= 1024 ? `${size / 1024}KB` : `${size}B`;
    console.log(
      label.padEnd(10) +
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
