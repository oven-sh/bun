// pipes-stdin-throughput.mjs — Windows subprocess stdin pipe throughput (parent -> child).
//
// CLAIM: after Bun's Windows pipe writer moves off libuv (the libuv-removal work
// the removal "Pipe streams"), a Bun parent streaming data INTO a child (piping through
// formatters, compilers, `bun build | tool`, etc.) gets higher MB/s and lower parent CPU.
// Today Bun and Node are ~at parity: both pay the same libuv pipe-write tax.
//
// MECHANISM (refs into the libuv worktree src/win/pipe.c, and Bun src/io/PipeWriter.rs):
//   Every parent-side write today is uv_write on an overlapped pipe:
//     1. WriteFile(.., &req->overlapped)                     pipe.c:1715-1725 (uv__pipe_write_data)
//     2. even when WriteFile completes synchronously (pipe buffer has room — the common
//        case), libuv does NOT use FILE_SKIP_COMPLETION_PORT_ON_SUCCESS, so a completion
//        packet is still queued, dequeued by uv_run, and dispatched
//        (uv__process_pipe_write_req, pipe.c:2199-2247) before the next write is issued.
//     3. Bun keeps exactly one uv_write_t in flight (src/io/PipeWriter.rs:1441-1442), so
//        every chunk costs: WriteFile + IOCP dequeue + callback dispatch + JS drain tick.
//   A native writer (plan the removal) sets FILE_SKIP_COMPLETION_PORT_ON_SUCCESS: a write
//   that completes inline costs ONE WriteFile and no loop roundtrip; only writes that
//   actually block (pipe full) take the overlapped completion path. (The "no synchronous
//   try-write" prohibition, ledger HIST-68, is about uv_try_write's framing semantics on
//   IPC pipes — an overlapped WriteFile that happens to complete inline is the sanctioned
//   pattern.)
//
// RUN (same commands before and after the migration; the delta is the result):
//   bun  bench/libuv-removal/pipes-stdin-throughput.mjs           # Bun parent (measured path)
//   node bench/libuv-removal/pipes-stdin-throughput.mjs           # Node reference (same uv tax)
//   bun  ... --bun-api                                            # Bun.spawn FileSink stdin
//   CHILD=node bun ...                                            # pin child runtime to isolate the parent
//   Flags: --json, --quick (2 repeats), --repeats=N, --target-secs=S
//
// Child reads via fs.readSync(0, ...) — one blocking ReadFile per chunk in both runtimes
// (no libuv stream machinery in the child), so the parent's write path dominates.

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

const SIZES = [4096, 65536, 1048576];
const MIN_TOTAL = 16 * 1024 * 1024;
const MAX_TOTAL = 1024 * 1024 * 1024;

// Child: READY handshake (so spawn/boot cost is outside the clock), then a blocking
// fs.readSync loop until EOF, then DONE <bytes>. Windows quirk: at pipe EOF readSync
// either returns 0 or throws code EOF (-4095) — both handled.
function childCode() {
  return (
    `const fs=require('fs');fs.writeSync(1,'READY\\n');` +
    `const buf=Buffer.alloc(1<<20);let total=0;` +
    `for(;;){let n=0;try{n=fs.readSync(0,buf,0,buf.length,null);}` +
    `catch(e){if(e.code==='EOF'||e.code==='EPIPE')break;throw e;}` +
    `if(n===0)break;total+=n;}` +
    `fs.writeSync(1,'DONE '+total+'\\n');`
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

// Line-oriented waiter over a stdout stream with failure wiring.
function lineWaiter(stream, child) {
  let buf = "";
  const lines = [];
  const waiters = [];
  let err = null;
  stream.setEncoding("utf8");
  stream.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      lines.push(buf.slice(0, i).trim());
      buf = buf.slice(i + 1);
    }
    while (waiters.length && lines.length) waiters.shift().resolve(lines.shift());
  });
  const failAll = e => {
    err = e;
    while (waiters.length) waiters.shift().reject(e);
  };
  child.on("error", failAll);
  child.on("exit", (code, sig) => {
    if (code !== 0) failAll(new Error(`child exited ${code} ${sig ?? ""}`));
    else failAll(new Error("child exited before expected output"));
  });
  return {
    next() {
      if (lines.length) return Promise.resolve(lines.shift());
      if (err) return Promise.reject(err);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
  };
}

async function runOnce(size, total) {
  const buf = Buffer.alloc(size, 66);
  const cpu0 = process.cpuUsage();
  let t0, t1, doneLine;

  if (USE_BUN_API) {
    const proc = Bun.spawn({
      cmd: [CHILD, "-e", childCode()],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    let acc = "";
    const dec = new TextDecoder();
    const nextLine = async () => {
      let i;
      while ((i = acc.indexOf("\n")) < 0) {
        const { value, done } = await reader.read();
        if (done) throw new Error("child stdout ended early");
        acc += dec.decode(value, { stream: true });
      }
      const line = acc.slice(0, i).trim();
      acc = acc.slice(i + 1);
      return line;
    };
    const ready = await nextLine();
    if (ready !== "READY") throw new Error(`expected READY, got ${ready}`);
    t0 = hr();
    let left = total;
    while (left > 0) {
      const n = Math.min(left, size);
      const r = proc.stdin.write(n === size ? buf : buf.subarray(0, n));
      if (r && typeof r.then === "function") await r;
      const f = proc.stdin.flush();
      if (f && typeof f.then === "function") await f;
      left -= n;
    }
    await proc.stdin.end();
    doneLine = await nextLine();
    t1 = hr();
    const code = await proc.exited;
    if (code !== 0) throw new Error(`child exited ${code}`);
  } else {
    const child = spawn(CHILD, ["-e", childCode()], { stdio: ["pipe", "pipe", "inherit"] });
    const lw = lineWaiter(child.stdout, child);
    const ready = await lw.next();
    if (ready !== "READY") throw new Error(`expected READY, got ${ready}`);
    t0 = hr();
    let left = total;
    while (left > 0) {
      const n = Math.min(left, size);
      if (!child.stdin.write(n === size ? buf : buf.subarray(0, n))) {
        await once(child.stdin, "drain");
      }
      left -= n;
    }
    child.stdin.end();
    doneLine = await lw.next();
    t1 = hr();
  }

  const m = /^DONE (\d+)$/.exec(doneLine);
  if (!m || Number(m[1]) !== total) throw new Error(`bad DONE line: "${doneLine}" (expected ${total})`);
  const cpu = process.cpuUsage(cpu0);
  const secs = Number(t1 - t0) / 1e9;
  return {
    mbps: total / 1e6 / secs,
    secs,
    cpuMsPerGB: (cpu.user + cpu.system) / 1e3 / (total / 1e9),
  };
}

async function bench(size) {
  const calTotal = MIN_TOTAL;
  const cal = await runOnce(size, calTotal); // warmup + calibration
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
  script: "pipes-stdin-throughput",
  runtime,
  parentApi: USE_BUN_API ? "Bun.spawn FileSink" : "node:child_process stdin.write",
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
    const label = size >= 1048576 ? `${size / 1048576}MB` : `${size / 1024}KB`;
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
