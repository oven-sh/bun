// eventloop-idle-cpu.mjs
//
// CLAIM (conditional — likely a does-not-move control, run it to prove it):
// an idle Bun process with timers armed should consume ~zero CPU. Today each
// interval fire on Windows pays the double-heap churn: on_uv_timer ->
// drain_timers -> ensure_uv_timer re-arm = uv_update_time + uv_timer_start
// heap ops on TWO timer heaps (src/runtime/timer/mod.rs:709-776), plus the
// uv_run handle-phase walk per wake (libuv src/win/core.c:701+). The native
// loop (plan the removal) arms ONE heap and honors the poll timeout directly
// (today's computed timespec is discarded, src/uws_sys/Loop.rs:469-472).
//
// MEASURED 2026-06-29 (Win11, bun 1.4.0 / node 25.8.1, one 10s run each):
//   single: bun 31ms CPU/10s (0.31% of one core) vs node 0ms — at the 15.6ms
//   granularity of GetProcessTimes this is 2 ticks vs 0; real but tiny.
//   many (50 intervals): bun 63ms vs node 46ms per 10s (0.63% vs 0.46%).
// VERDICT: near-noise; deltas are <=0.3% of one core and attribution is
// confounded by JSC GC heartbeats. NOT a sellable libuv-removal win — kept as
// a regression guard that the native loop stays as quiet as uv_run when idle.
//
// RUN:  bun  bench/libuv-removal/eventloop-idle-cpu.mjs single
//       bun  bench/libuv-removal/eventloop-idle-cpu.mjs many
//       node bench/libuv-removal/eventloop-idle-cpu.mjs single
//       node bench/libuv-removal/eventloop-idle-cpu.mjs many

const mode = process.argv[2] || "single";
const DURATION_MS = 10_000;
const now = () => process.hrtime.bigint();

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;

let fires = 0;
const timers = [];
if (mode === "single") {
  timers.push(setInterval(() => fires++, 1000));
} else if (mode === "many") {
  // 50 coprime-ish periods, 101..1003 ms, staggered so wakes don't coalesce.
  for (let i = 0; i < 50; i++) {
    timers.push(setInterval(() => fires++, 101 + i * 18 + (i % 7)));
  }
} else {
  console.error(`unknown mode: ${mode} (use single|many)`);
  process.exit(1);
}

const t0 = now();
const cpu0 = process.cpuUsage();

setTimeout(() => {
  const cpu = process.cpuUsage(cpu0);
  const wallMs = Number(now() - t0) / 1e6;
  for (const t of timers) clearInterval(t);
  const row = {
    runtime,
    mode,
    wall_ms: +wallMs.toFixed(1),
    cpu_user_us: cpu.user,
    cpu_system_us: cpu.system,
    cpu_total_us: cpu.user + cpu.system,
    cpu_pct_of_one_core: +(((cpu.user + cpu.system) / 1000 / wallMs) * 100).toFixed(3),
    interval_fires: fires,
  };
  console.log(
    `idle-cpu mode=${mode}: ${row.cpu_total_us} us CPU over ${row.wall_ms} ms wall ` +
      `(${row.cpu_pct_of_one_core}% of one core), ${fires} interval fires — ${runtime}`,
  );
  console.log(JSON.stringify(row));
}, DURATION_MS);
