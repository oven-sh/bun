// eventloop-timer-precision.mjs
//
// WHAT THIS MEASURES: setTimeout(d) actual-elapsed distributions, setInterval
// effective rates, and (bun --probe) the raw IOCP wait the native loop would
// issue. This is the before/after gauge for the Phase 1 timer rewrite AND a
// never-fires-early regression guard (Phase 1 exit criteria).
//
// TODAY'S BEHAVIOR (measured 2026-06-29, Win11, bun 1.4.0 / node 25.8.1):
//   bun  setTimeout(16): p50 ~31.6ms elapsed (overshoot 15.6); setInterval(16)
//        runs at ~34 Hz (54% of the requested 62.5 Hz). Never fires early.
//   node setTimeout(16): p50 ~16.7ms BUT with early fires (up to -0.96ms,
//        ~7% of samples) — node's ms-stale due arithmetic fires BEFORE the
//        deadline, a bug Bun must not copy; node setInterval(16) ~36 Hz.
//   raw GQCS(16) (--probe): BISTABLE ~16.2 or ~31.3ms depending on how the
//        sequential chain phase-locks to the ~15.6ms interrupt grid.
//
// MECHANISM (verified in source):
//  - Bun's computed poll timeout is DISCARDED (src/uws_sys/Loop.rs:469-472);
//    JS timers wake uv_run via a SECOND uv_timer_t heap (src/runtime/timer/
//    mod.rs:688-755) armed with max(1, floor(remaining_ms)) — ms_unsigned()
//    floors (src/bun_core/util.rs:5172-5174; clamp timer/mod.rs:745). For
//    setTimeout(16) the uv timer is armed at 15ms, wakes BEFORE the ns
//    deadline, drain_timers fires nothing, re-arms max(1, floor(0.4))=1ms
//    (timer/mod.rs:762-776) — a SPURIOUS SECOND WAKE every such timer.
//
// HONEST ATTRIBUTION (what removal does and does not buy):
//  - Phase 1 as written (single ns heap, GQCSEx timeout honored, never-early):
//    deletes the spurious second wake (CPU only) and the double-heap churn;
//    LATENCY for quantum-straddling delays stays ~2 quanta when the chain
//    phase-locks — the kernel rounds blocking waits up to interrupt ticks and
//    the plan forbids timeBeginPeriod (ADD-02).
//  - The 2x latency / 60fps win (31.6 -> ~16.3ms, 34 -> ~60Hz) requires the
//    native loop to add a high-resolution timer source (e.g.
//    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION posted into the IOCP). libuv
//    1.51/1.52 has no such facility (verified: no high-res APIs in
//    libuv-read/src/win/) — owning the loop is what makes this policy
//    POSSIBLE. Track it as a Phase 1 design option, not an automatic effect.
//
// EVIDENCE MODES:
//   bun  eventloop-timer-precision.mjs            today's behavior (before)
//   node eventloop-timer-precision.mjs            single-uv-heap reference
//   bun  eventloop-timer-precision.mjs --probe    bun:ffi raw GQCS(timeout)
//        distribution in the SAME process — the naive native-loop wait floor.

const now = () => process.hrtime.bigint();
const isBun = typeof Bun !== "undefined";
const runtime = isBun ? `bun ${Bun.version}` : `node ${process.version}`;

if (isBun && process.argv.includes("--probe")) {
  // Raw IOCP wait probe: what GQCSEx(timeout) delivers with zero loop layers.
  const { dlopen, FFIType, ptr } = await import("bun:ffi");
  const k32 = dlopen("kernel32.dll", {
    CreateIoCompletionPort: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.u32],
      returns: FFIType.ptr,
    },
    GetQueuedCompletionStatus: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
  });
  const iocp = k32.symbols.CreateIoCompletionPort(-1, null, 0n, 0);
  if (!iocp) throw new Error("CreateIoCompletionPort failed");
  const bytes = new Uint32Array(2),
    key = new BigUint64Array(1),
    ovl = new BigUint64Array(1);
  console.log(`# RAW GetQueuedCompletionStatus(timeout) — native-loop wait floor — ${runtime}`);
  for (const t of [1, 5, 10, 15, 16, 17, 20, 32]) {
    const xs = [];
    for (let i = 0; i < 40; i++) {
      const t0 = now();
      k32.symbols.GetQueuedCompletionStatus(iocp, ptr(bytes), ptr(key), ptr(ovl), t);
      xs.push(Number(now() - t0) / 1e6);
    }
    xs.sort((a, b) => a - b);
    console.log(
      `GQCS(${String(t).padStart(2)}ms): min ${xs[0].toFixed(2).padStart(6)} ` +
        `p50 ${xs[20].toFixed(2).padStart(6)} p90 ${xs[36].toFixed(2).padStart(6)} max ${xs[39].toFixed(2).padStart(6)}`,
    );
  }
  process.exit(0);
}

const PLAN = [
  { delay: 1, samples: 150 },
  { delay: 5, samples: 150 },
  { delay: 10, samples: 100 },
  { delay: 16, samples: 150 }, // headline: just past one quantum
  { delay: 17, samples: 100 }, // inside the same penalty band
  { delay: 32, samples: 80 }, // just past two quanta
];
const INTERVALS = [16, 33]; // 60fps / 30fps tickers, effective Hz over 2.5s

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function sampleTimeout(delay) {
  return new Promise(resolve => {
    const t0 = now();
    setTimeout(() => resolve(Number(now() - t0) / 1e6), delay);
  });
}

function intervalRate(periodMs, durationMs) {
  return new Promise(resolve => {
    let fires = 0;
    const t0 = now();
    const h = setInterval(() => fires++, periodMs);
    setTimeout(() => {
      clearInterval(h);
      resolve(fires / (Number(now() - t0) / 1e9));
    }, durationMs);
  });
}

console.log(`# setTimeout(d) actual-elapsed distribution — ${runtime} on ${process.platform}`);
console.log(`# overshoot = elapsed - d (ms); early fires counted separately`);

const out = { runtime, rows: [], intervals: [] };
for (const { delay, samples } of PLAN) {
  for (let i = 0; i < 10; i++) await sampleTimeout(delay); // warmup
  const xs = [];
  for (let i = 0; i < samples; i++) xs.push(await sampleTimeout(delay));
  const over = xs.map(x => x - delay).sort((a, b) => a - b);
  const early = over.filter(x => x < -0.05).length;
  const row = {
    delay,
    n: samples,
    early,
    min: +over[0].toFixed(2),
    p50: +pct(over, 50).toFixed(2),
    p90: +pct(over, 90).toFixed(2),
    p99: +pct(over, 99).toFixed(2),
    max: +over[over.length - 1].toFixed(2),
  };
  out.rows.push(row);
  console.log(
    `setTimeout(${String(delay).padStart(2)})  overshoot ms  ` +
      `min ${row.min.toFixed(2).padStart(6)}  p50 ${row.p50.toFixed(2).padStart(6)}  ` +
      `p90 ${row.p90.toFixed(2).padStart(6)}  p99 ${row.p99.toFixed(2).padStart(6)}  ` +
      `max ${row.max.toFixed(2).padStart(6)}  early=${early}  n=${samples}`,
  );
}

for (const period of INTERVALS) {
  await intervalRate(period, 300); // warmup
  const hz = await intervalRate(period, 2_500);
  const ideal = 1000 / period;
  out.intervals.push({ period, hz: +hz.toFixed(1), ideal: +ideal.toFixed(1) });
  console.log(
    `setInterval(${period}): ${hz.toFixed(1)} Hz effective (ideal ${ideal.toFixed(1)} Hz, ` +
      `${((100 * hz) / ideal).toFixed(0)}% of requested rate)`,
  );
}
console.log(JSON.stringify(out));
