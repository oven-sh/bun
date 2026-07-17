// Shared by perf_hooks and worker_threads, as node shares
// lib/internal/perf/event_loop_utilization.js between the two.
//
// `elu` is [elapsedSinceLoopStartMs, idleMs] from native, or null when the loop
// has not turned yet — node's equivalent of its `loopStart <= 0` branch, and it
// is checked first there too, so elu(u, u) before the loop turns is {0,0,0}
// rather than NaN.
//
// The divisions are deliberately unguarded: node returns NaN for a zero total
// (verified on v26.3.0 — eventLoopUtilization(u, u) after the loop has turned
// yields NaN), so collapsing that to 0 would diverge.
function internalEventLoopUtilization(elu, util1, util2) {
  if (elu === null) {
    return { idle: 0, active: 0, utilization: 0 };
  }

  if (util2) {
    const idle = util1.idle - util2.idle;
    const active = util1.active - util2.active;
    return { idle, active, utilization: active / (idle + active) };
  }

  const idle = elu[1];
  const active = elu[0] - idle;

  if (!util1) {
    return { idle, active, utilization: active / (idle + active) };
  }

  const idleDelta = idle - util1.idle;
  const activeDelta = active - util1.active;
  return { idle: idleDelta, active: activeDelta, utilization: activeDelta / (idleDelta + activeDelta) };
}

export default { internalEventLoopUtilization };
