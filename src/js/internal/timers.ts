const { validateNumber } = require("internal/validators");

const NumberIsFinite = Number.isFinite;

const TIMEOUT_MAX = 2 ** 31 - 1;

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
};
