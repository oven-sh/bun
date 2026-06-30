// eventloop-settimeout-chain.mjs
//
// CLAIM (conditional): setTimeout(0)/setTimeout(1) chain throughput on Windows
// is bounded by blocking-wait quantization plus the libuv double timer hop.
// The hop chain today: JS arm -> Bun TimerHeap insert -> ensure_uv_timer arms a
// SECOND (libuv-heap) timer with max(1, floor(remaining_ms))
// (src/runtime/timer/mod.rs:709-755, floor at src/bun_core/util.rs:5172-5174)
// -> auto_tick discards the computed poll timespec (src/uws_sys/Loop.rs:469-472)
// -> uv_run(ONCE) blocks in GQCSEx on uv's backend timeout -> on_uv_timer ->
// drain_timers -> fire -> re-arm both heaps (timer/mod.rs:762-776).
//
// MEASURED 2026-06-29 (Win11, bun 1.4.0 / node 25.8.1):
//   setTimeout(0) chain: bun 63/s, node 66/s. setTimeout(1): bun 63/s,
//   node 61/s. Both runtimes are pinned to one ~15.6ms kernel quantum per
//   iteration (15.7-16.3 ms/iter).
// VERDICT: NO libuv-removal win here. The native loop keeps GQCSEx and never
// calls timeBeginPeriod (plan ADD-02), so the quantum floor stays. Kept as a
// regression guard (the Phase 1 rewrite must not make this SLOWER, e.g. by
// double-sleeping) and as the recorded negative for "setTimeout(0) chains get
// faster" claims.
//
// RUN:  bun  bench/libuv-removal/eventloop-settimeout-chain.mjs
//       node bench/libuv-removal/eventloop-settimeout-chain.mjs

const now = () => process.hrtime.bigint();
const BUDGET_MS = 2_000;
const REPEATS = 3;

function chainTimeout(delay, budgetMs) {
  return new Promise(resolve => {
    let count = 0;
    const t0 = now();
    const budget = BigInt(budgetMs) * 1_000_000n;
    function step() {
      count++;
      const elapsed = now() - t0;
      if (elapsed >= budget) return resolve({ count, ns: Number(elapsed) });
      setTimeout(step, delay);
    }
    setTimeout(step, delay);
  });
}

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(`# setTimeout(d) chain throughput (${BUDGET_MS}ms budget) — ${runtime} on ${process.platform}`);

const out = { runtime, rows: [] };
for (const delay of [0, 1]) {
  await chainTimeout(delay, 200); // warmup
  const rates = [];
  for (let r = 0; r < REPEATS; r++) {
    const { count, ns } = await chainTimeout(delay, BUDGET_MS);
    rates.push(count / (ns / 1e9));
  }
  rates.sort((a, b) => a - b);
  const med = rates[Math.floor(rates.length / 2)];
  out.rows.push({ delay, iters_per_s_med: +med.toFixed(1), ms_per_iter: +(1000 / med).toFixed(3) });
  console.log(
    `setTimeout(${delay}) chain: ${med.toFixed(0).padStart(6)} iters/s (med of ${REPEATS})  ` +
      `= ${(1000 / med).toFixed(3)} ms/iter   spread ${rates[0].toFixed(0)}..${rates[rates.length - 1].toFixed(0)}`,
  );
}
console.log(JSON.stringify(out));
