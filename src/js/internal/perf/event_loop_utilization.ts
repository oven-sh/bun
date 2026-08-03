// Shared by perf_hooks and worker_threads; see https://github.com/nodejs/node/blob/main/lib/internal/perf/event_loop_utilization.js
// `elu` is [elapsedSinceLoopStartMs, idleMs] or null before the loop turns (node's `loopStart <= 0` branch → {0,0,0}).
// Divisions are unguarded: node returns NaN for a zero total, collapsing to 0 would diverge.
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
