// eventloop-setimmediate-chain.mjs
//
// CLAIM: setImmediate tick turnaround on Windows gets faster when the libuv
// loop is replaced by the native IOCP loop (plan Phase 1), because today every
// chained setImmediate pays a full uv_run(UV_RUN_ONCE) handle-phase walk PLUS a
// self-inflicted uv_async_send wakeup (PostQueuedCompletionStatus syscall +
// IOCP packet dequeue + pending-req dispatch) per tick.
//
// MECHANISM (before, all verified in-tree):
//  - auto_tick (src/runtime/jsc_hooks.rs:854): on Windows, pending immediates
//    force `(*el).wakeup()` => us_wakeup_loop => uv_async_send EVERY tick
//    (jsc_hooks.rs:868-872; libuv src/win/async.c:83-100 = atomic flag +
//    PostQueuedCompletionStatus; the packet is dequeued by GQCSEx and
//    dispatched back through uv__process_reqs -> uv__process_async_wakeup_req).
//  - tick_with_timeout DISCARDS its timespec (src/uws_sys/Loop.rs:469-472) and
//    calls us_loop_run = us_loop_integrate + uv_update_time + uv_run(UV_RUN_ONCE)
//    (packages/bun-usockets/src/eventing/libuv.c:214-219).
//  - pending immediates keep a uv_idle_t armed (src/runtime/timer/mod.rs:1052-1094,
//    no-op callback :1092) so uv_backend_timeout returns 0 (libuv
//    src/win/core.c:413-422) and uv_run cannot block. Per tick uv_run walks:
//    process_reqs -> idle_invoke -> prepare_invoke -> GetQueuedCompletionStatusEx(0)
//    -> process_reqs (x<=8) -> check_invoke -> endgames -> update_time+run_timers
//    (libuv src/win/core.c:701+).
//  AFTER (plan Phase 1): the native loop's run-once sees pending immediates and
//  polls IOCP with timeout 0 directly. Deleted per tick: the uv_async_send
//  syscall + packet round-trip, the uv_idle/async/timer handle queue walks, the
//  double uv_update_time, us_loop_integrate, and the pending-req trampoline.
//  Kept: prepare/check as direct phase hooks, GQCSEx itself.
//
// ATTRIBUTION: the queueMicrotask chain is the in-runtime control — it never
// touches the loop, so perIter(setImmediate) - perIter(microtask) isolates the
// per-tick loop cost from JS dispatch cost. Track THAT GAP before/after.
// bun-vs-node compares different engines (JSC vs V8) — sanity reference only.
//
// MEASURED 2026-06-29 (Win11, 24 cores; two runs, ~15% run-to-run machine
// variance, gap direction stable):
//   bun 1.4.0:   setImmediate 816-965 ns/it (1.04-1.23M/s), microtask 24 ns/it
//                => loop overhead 792-941 ns/tick
//   node 25.8.1: setImmediate 1068 ns/it (0.94M/s), microtask 20 ns/it
//                => loop overhead 1048 ns/tick (same libuv architecture)
//   --probe (bun:ffi, same process, quiet machine, 4 stable reps):
//     GQCS(0) empty poll:            265-290 ns/op  (the native loop KEEPS this)
//     PQCS + GQCS(0) packet dequeue: 490-506 ns/op
//     => deleted wakeup-packet cost: 200-240 ns/tick (minus ~50ns ffi-call
//        delta; absolute values include ~100ns bun:ffi overhead each)
// EXPECTED AFTER PHASE 1: deleting the PQCS packet (~200ns) plus the uv
// handle-walk/endgame/double-update_time/us_loop_integrate bookkeeping
// (~200-400ns of the remaining budget) cuts tick overhead roughly in half:
// estimate 25-50% more setImmediate ticks/sec. The GQCSEx(0) syscall floor
// (~250-300ns) remains by design.
//
// RUN (before = bun 1.4.0 release; after = post-Phase-1 build):
//   bun  bench/libuv-removal/eventloop-setimmediate-chain.mjs
//   node bench/libuv-removal/eventloop-setimmediate-chain.mjs
//   bun  bench/libuv-removal/eventloop-setimmediate-chain.mjs --probe
//        (bun-only: ffi probe of the deleted PQCS wakeup round-trip cost)

const now = () => process.hrtime.bigint();

if (typeof Bun !== "undefined" && process.argv.includes("--probe")) {
  // Syscall-cost probe for attribution: the per-tick wakeup packet round trip
  // (PostQueuedCompletionStatus from jsc_hooks.rs:868-872's wakeup() + the
  // GQCS dequeue inside uv__poll) vs the empty zero-timeout poll the native
  // loop would still perform. ffi call overhead is common to both loops, so
  // read the DIFFERENCE, not the absolute values.
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
    PostQueuedCompletionStatus: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr],
      returns: FFIType.i32,
    },
  });
  const iocp = k32.symbols.CreateIoCompletionPort(-1, null, 0n, 0);
  if (!iocp) throw new Error("CreateIoCompletionPort failed");
  const bytes = new Uint32Array(2),
    key = new BigUint64Array(1),
    ovl = new BigUint64Array(1);
  const N = 200_000;
  for (let i = 0; i < 10_000; i++) {
    k32.symbols.PostQueuedCompletionStatus(iocp, 0, 0n, null);
    k32.symbols.GetQueuedCompletionStatus(iocp, ptr(bytes), ptr(key), ptr(ovl), 0);
  }
  for (let rep = 0; rep < 4; rep++) {
    let t0 = now();
    for (let i = 0; i < N; i++)
      k32.symbols.GetQueuedCompletionStatus(iocp, ptr(bytes), ptr(key), ptr(ovl), 0);
    const empty = Number(now() - t0) / N;
    t0 = now();
    for (let i = 0; i < N; i++) {
      k32.symbols.PostQueuedCompletionStatus(iocp, 0, 0n, null);
      k32.symbols.GetQueuedCompletionStatus(iocp, ptr(bytes), ptr(key), ptr(ovl), 0);
    }
    const rt = Number(now() - t0) / N;
    console.log(
      `GQCS(0) empty: ${empty.toFixed(0)} ns/op   PQCS+GQCS(0) dequeue: ${rt.toFixed(0)} ns/op   ` +
        `deleted wakeup-packet cost: ${(rt - empty).toFixed(0)} ns/tick`,
    );
  }
  process.exit(0);
}

const N_IMM = 50_000;
const N_MICRO = 1_000_000;
const REPEATS = 7;

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return { min: s[0], med, max: s[s.length - 1], mean, sd };
}

function chainImmediate(n) {
  return new Promise(resolve => {
    let i = 0;
    const t0 = now();
    function step() {
      if (++i >= n) return resolve(Number(now() - t0));
      setImmediate(step);
    }
    setImmediate(step);
  });
}

function chainMicrotask(n) {
  return new Promise(resolve => {
    let i = 0;
    const t0 = now();
    function step() {
      if (++i >= n) return resolve(Number(now() - t0));
      queueMicrotask(step);
    }
    queueMicrotask(step);
  });
}

function report(name, perIterNs, totalNsStats, n) {
  console.log(
    `${name.padEnd(22)} ${(1e9 / perIterNs.med).toFixed(0).padStart(10)} it/s   ` +
      `${perIterNs.med.toFixed(0).padStart(7)} ns/it (med)   ` +
      `spread ${perIterNs.min.toFixed(0)}..${perIterNs.max.toFixed(0)} ns/it   n=${n} x${REPEATS}`,
  );
}

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(`# setImmediate chain vs microtask chain — ${runtime} on ${process.platform}`);

// warmup
await chainImmediate(2_000);
await chainMicrotask(20_000);

const imm = [];
for (let r = 0; r < REPEATS; r++) imm.push((await chainImmediate(N_IMM)) / N_IMM);
const micro = [];
for (let r = 0; r < REPEATS; r++) micro.push((await chainMicrotask(N_MICRO)) / N_MICRO);

const immS = stats(imm);
const microS = stats(micro);
report("setImmediate chain", immS, null, N_IMM);
report("queueMicrotask chain", microS, null, N_MICRO);

const gap = immS.med - microS.med;
console.log(
  `loop overhead per tick (setImmediate - microtask): ${gap.toFixed(0)} ns ` +
    `(${(1e9 / immS.med).toFixed(0)} -> ${(1e9 / gap).toFixed(0)} ticks/s if JS dispatch were free)`,
);
console.log(
  JSON.stringify({
    runtime,
    imm_ns_per_iter_med: +immS.med.toFixed(1),
    imm_ns_spread: [+immS.min.toFixed(1), +immS.max.toFixed(1)],
    micro_ns_per_iter_med: +microS.med.toFixed(1),
    loop_overhead_ns_per_tick: +gap.toFixed(1),
  }),
);
