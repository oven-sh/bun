const { validateNumber } = require("internal/validators");

const NumberIsFinite = Number.isFinite;

const TIMEOUT_MAX = 2 ** 31 - 1;

/**
 * The real monotonic clock in whole milliseconds, for deadlines the runtime's
 * own JS keeps (a mark recorded now and compared against when a timer fires).
 * No JS-visible clock will do: bun:test's `setSystemTime()` overrides
 * `Date.now()` inside the engine, and `useFakeTimers()` also overrides
 * `performance.now()` and `process.hrtime()`, so a deadline measured with any
 * of them freezes or jumps along with the mock.
 */
const monotonicNowMs = $newRustFunction("runtime/timer/Timer.rs", "internal_bindings.monotonicNowMs", 0);

function getTimerDuration(msecs, name) {
  validateNumber(msecs, name);
  if (msecs < 0 || !NumberIsFinite(msecs)) {
    throw $ERR_OUT_OF_RANGE(name, "a non-negative finite number", msecs);
  }

  // Ensure that msecs fits into signed int32
  if (msecs > TIMEOUT_MAX) {
    process.emitWarning(
      `${msecs} does not fit into a 32-bit signed integer.` + `\nTimer duration was truncated to ${TIMEOUT_MAX}.`,
      "TimeoutOverflowWarning",
    );
    return TIMEOUT_MAX;
  }

  return msecs;
}

export default {
  // For hiding Timeouts on other internals. A registered symbol so the node
  // test harness's --expose-internals shim ("internal/timers" virtual module
  // in test/js/node/test/common/index.js) can hand the same symbol to ported
  // tests that inspect socket[kTimeout].
  kTimeout: Symbol.for("::buntimeout::"),
  getTimerDuration,
  monotonicNowMs,
};
