// What the compiler reads in place of src/js/internal/timers.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 ef4265ceb14d75668a2e4d7833f1f4927ff3678e1de0013e8d7b3c0967a8f4fe.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.
const { validateNumber } = require("internal/validators");

const NumberIsFinite = Number.isFinite;

const TIMEOUT_MAX = 2 ** 31 - 1;

function getTimerDuration(msecs: number, name: string) {
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

// For hiding Timeouts on other internals. A registered symbol so the node
// test harness's --expose-internals shim ("internal/timers" virtual module
// in test/js/node/test/common/index.js) can hand the same symbol to ported
// tests that inspect socket[kTimeout].
// A constant of its own: off this line the compiler reads the key of the fields that node:net and node:http2 declare under it.
const kTimeout = Symbol.for("::buntimeout::");

export default {
  kTimeout,
  getTimerDuration,
} as { readonly kTimeout: typeof kTimeout; getTimerDuration: typeof getTimerDuration };
