// pipes-ipc-throughput.mjs — Windows child_process IPC: round-trip latency + message throughput.
//
// CLAIM: after Bun's Windows IPC moves off libuv's ipc-mode pipes (LIBUV_WINDOWS_REMOVAL_PLAN.md
// Phase 3.3 "Pipe streams" -> IPC), .send() message throughput rises and per-message
// overhead drops. The win is biggest for many small messages (worker pools, test-runner
// workers, cluster-style fanout). Today Bun and Node are ~at parity: both ride the exact
// same libuv framing code.
//
// MECHANISM (refs into the libuv worktree src/win/pipe.c; Bun side src/jsc/ipc.rs:769,878):
//   SEND, per message: uv__pipe_write_ipc builds [16B frame header][payload] and calls
//     uv__pipe_write_data with copy_always=1 (pipe.c:1764-1857) -> ALWAYS takes
//     uv__build_coalesced_write_req (pipe.c:1536-1593): a heap alloc + full memcpy of the
//     payload, then WriteFile, then an IOCP completion dequeue + uv__free
//     (pipe.c:2199-2247). Three per-message costs (alloc, copy, loop roundtrip) on top of
//     the one WriteFile that does the work.
//   RECEIVE, per message: the pending 0-byte "zero read" completes (pipe.c:1400-1458),
//     uv_run dequeues it, then uv__pipe_read_ipc does a blocking read-exactly of the 16B
//     header (pipe.c:1939-1965, GetOverlappedResult if pending) + a separate ReadFile for
//     the payload (pipe.c:1968-2047) + re-arms the zero read. >=4 syscalls per message;
//     frame-exact reads are mandatory in libuv's design (ledger PIPE-48: read-exactly
//     blocks, so it must never speculate past a frame).
//   A native IPC (plan Phase 3.3): one WriteFile per send from a reusable frame buffer
//   (header+payload still ONE write — wire ABI), FILE_SKIP_COMPLETION_PORT_ON_SUCCESS for
//   inline completions, and a buffered reader that posts real overlapped reads into a
//   64KB buffer and parses frames in userspace — a burst of N small messages costs ~1-2
//   syscalls per WAKEUP instead of >=4 per MESSAGE. (A buffered reader never blocks
//   waiting for "exactly N", so PIPE-48's no-speculation constraint doesn't apply to it.)
//
// RUN (same commands before and after the migration; the delta is the result):
//   bun  bench/libuv-removal/pipes-ipc-throughput.mjs             # bun<->bun (measured path)
//   node bench/libuv-removal/pipes-ipc-throughput.mjs             # node<->node reference
//   Flags: --json, --quick, --repeats=N
//
// Uses node:child_process.fork with serialization:"json" in both runtimes so the JS API,
// serialization format, and wire framing are identical; only the pipe layer differs after
// the migration. RTT is scheduling/JS dominated (expect a modest win); the pipelined
// burst is where the per-message pipe tax shows.

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const IS_BUN = typeof Bun !== "undefined";

// ---------------- child ----------------
if (process.argv.includes("--ipc-child")) {
  let burst = 0;
  process.on("message", m => {
    switch (m.t) {
      case "ping":
        process.send({ t: "pong", i: m.i, p: m.p });
        break;
      case "b":
        burst++;
        break;
      case "flush":
        process.send({ t: "ack", n: burst });
        break;
      case "end":
        process.send({ t: "done", n: burst });
        burst = 0;
        break;
      case "exit":
        process.exit(0);
    }
  });
  process.send({ t: "ready" });
} else {
  await parentMain();
}

// ---------------- parent ----------------
async function parentMain() {
  const args = process.argv.slice(2);
  const flag = n => args.includes(n);
  const opt = (n, d) => {
    const p = args.find(a => a.startsWith(n + "="));
    return p ? p.slice(n.length + 1) : d;
  };
  const QUICK = flag("--quick");
  const REPEATS = Number(opt("--repeats", QUICK ? 2 : 5));
  const JSON_OUT = flag("--json");
  const RTT_N = QUICK ? 300 : 1000;
  const BATCH = 500;

  const child = fork(SELF, ["--ipc-child"], {
    serialization: "json",
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });

  // single persistent handler + resolver queue; all failure paths reject
  const waiters = [];
  let childErr = null;
  child.on("message", m => {
    const w = waiters.shift();
    if (w) w.resolve(m);
  });
  const failAll = e => {
    childErr = e;
    while (waiters.length) waiters.shift().reject(e);
  };
  child.on("error", failAll);
  child.on("exit", (code, sig) => {
    if (waiters.length) failAll(new Error(`child exited early: ${code} ${sig ?? ""}`));
  });
  const recv = () => {
    if (childErr) return Promise.reject(childErr);
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };
  const send = m =>
    new Promise((resolve, reject) => {
      child.send(m, e => (e ? reject(e) : resolve()));
    });

  const ready = await recv();
  if (ready.t !== "ready") throw new Error(`expected ready, got ${JSON.stringify(ready)}`);

  const hr = () => process.hrtime.bigint();
  const stats = xs => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
    return { median, min: s[0], max: s[s.length - 1], sd, n: s.length };
  };

  const pad64 = Buffer.alloc(64, 120).toString();
  const pad4k = Buffer.alloc(4096, 120).toString();

  // ---- phase A: sequential round trips (latency) ----
  async function rttRun(n, pad) {
    // warmup
    for (let i = 0; i < 100; i++) {
      child.send({ t: "ping", i, p: pad });
      await recv();
    }
    const t0 = hr();
    for (let i = 0; i < n; i++) {
      child.send({ t: "ping", i, p: pad });
      const r = await recv();
      if (r.t !== "pong") throw new Error(`expected pong, got ${r.t}`);
    }
    const dt = Number(hr() - t0);
    return { usPerRtt: dt / 1e3 / n, rttPerSec: n / (dt / 1e9) };
  }

  // ---- phase B: pipelined one-way burst (throughput) ----
  // batches of BATCH messages with a flush/ack handshake so neither runtime's
  // internal send queue grows unboundedly; ack cost is 1 RTT per BATCH msgs.
  async function burstRun(total, pad) {
    const t0 = hr();
    let sent = 0;
    while (sent < total) {
      const n = Math.min(BATCH, total - sent);
      for (let j = 0; j < n; j++) child.send({ t: "b", p: pad });
      sent += n;
      child.send({ t: "flush" });
      const a = await recv();
      if (a.t !== "ack") throw new Error(`expected ack, got ${a.t}`);
    }
    await send({ t: "end" });
    const d = await recv();
    if (d.t !== "done") throw new Error(`expected done, got ${d.t}`);
    if (d.n !== total) throw new Error(`child counted ${d.n}, expected ${total}`);
    const secs = Number(hr() - t0) / 1e9;
    return { msgsPerSec: total / secs, secs };
  }

  const results = [];

  // RTT: 64B payload
  {
    const runs = [];
    for (let i = 0; i < REPEATS; i++) runs.push(await rttRun(RTT_N, pad64));
    results.push({
      phase: "rtt-64B",
      n: RTT_N,
      usPerRtt: stats(runs.map(r => r.usPerRtt)),
      rttPerSec: stats(runs.map(r => r.rttPerSec)),
    });
  }

  // bursts: 64B and 4KB payloads
  for (const [label, pad, total] of [
    ["burst-64B", pad64, QUICK ? 10000 : 30000],
    ["burst-4KB", pad4k, QUICK ? 4000 : 10000],
  ]) {
    await burstRun(Math.min(2000, total), pad); // warmup
    const runs = [];
    for (let i = 0; i < REPEATS; i++) runs.push(await burstRun(total, pad));
    results.push({ phase: label, n: total, msgsPerSec: stats(runs.map(r => r.msgsPerSec)) });
  }

  await send({ t: "exit" }).catch(() => {});
  child.disconnect?.();

  const runtime = IS_BUN ? `bun ${Bun.version}` : `node ${process.versions.node}`;
  const header = {
    script: "pipes-ipc-throughput",
    runtime,
    serialization: "json",
    repeats: REPEATS,
    platform: `${process.platform} ${process.arch}`,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ ...header, results }, null, 2));
  } else {
    console.log(`# ${header.script}  parent+child=${runtime}  serialization=json  repeats=${REPEATS}`);
    for (const r of results) {
      if (r.phase.startsWith("rtt")) {
        console.log(
          `${r.phase.padEnd(12)} median ${r.usPerRtt.median.toFixed(1)} us/rtt  ` +
            `(${r.rttPerSec.median.toFixed(0)} rtt/s, min ${r.usPerRtt.min.toFixed(1)}, ` +
            `max ${r.usPerRtt.max.toFixed(1)}, sd ${r.usPerRtt.sd.toFixed(1)}, n=${r.n})`,
        );
      } else {
        console.log(
          `${r.phase.padEnd(12)} median ${r.msgsPerSec.median.toFixed(0)} msg/s  ` +
            `(min ${r.msgsPerSec.min.toFixed(0)}, max ${r.msgsPerSec.max.toFixed(0)}, ` +
            `sd ${r.msgsPerSec.sd.toFixed(0)}, n=${r.n})`,
        );
      }
    }
  }
}
