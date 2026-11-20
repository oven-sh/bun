type ELDHistogram = import("node:perf_hooks").IntervalHistogram;

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/event_loop_delay.js#L70
$overriddenName = "[Symbol.dispose]";
export function dispose(this: ELDHistogram) {
  this.disable();
}
