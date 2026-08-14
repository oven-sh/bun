const { validateNumber } = require("internal/validators");

const NumberIsFinite = Number.isFinite;

const TIMEOUT_MAX = 2 ** 31 - 1;

// Timers for the runtime's own deadlines (socket idle timeouts, listen()
// callbacks, child_process kill timers, ...). The globals belong to user code:
// jest.useFakeTimers() freezes, counts, advances and clears every timer created
// through them, and user code may replace them outright. These create the same
// Timeout objects but never take part in fake timers, like the private timer
// references Node's lib/ uses. Built-in modules take all four from here
// (test/internal/source-lints/builtin-timer-globals.test.ts); the global
// clearTimeout would clear these too, the private one just stays out of reach
// of replaced globals.
const setTimeout = $newCppFunction("node/NodeTimers.cpp", "functionSetTimeoutInternal", 1);
const setInterval = $newCppFunction("node/NodeTimers.cpp", "functionSetIntervalInternal", 1);
const clearTimeout = $newCppFunction("node/NodeTimers.cpp", "functionClearTimeout", 1);
const clearInterval = $newCppFunction("node/NodeTimers.cpp", "functionClearInterval", 1);

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
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
};
