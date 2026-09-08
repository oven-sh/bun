// Comprehensive REPRL wrapper for Bun fuzzing with all runtime APIs exposed
// Based on workerd's approach to maximize fuzzing coverage
// https://bun.com/docs/runtime

const REPRL_CRFD = 100; // Control read FD
const REPRL_CWFD = 101; // Control write FD
const REPRL_DRFD = 102; // Data read FD

const fs = require("node:fs");

// Make common Node modules available
globalThis.require = require;
globalThis.__dirname = "/";
globalThis.__filename = "/fuzzilli.js";

// process.execve replaces the process image on success, which kills the REPRL
// child, so fuzzed scripts must not be able to reach the real implementation.
process.execve = () => {};

// Captured up front: fuzzed scripts overwrite globals and prototype methods.
const { String, setTimeout, setInterval, setImmediate, clearTimeout, clearInterval, clearImmediate } = globalThis;
const { apply } = Reflect;
const { forEach: mapForEach, set: mapSet, clear: mapClear } = Map.prototype;
const print = console.log.bind(console);
const addListener = process.on.bind(process);
const removeListener = process.off.bind(process);
const exit = process.exit.bind(process);

// Print uncaught exception like workerd does. String(err) can throw.
function reportUncaught(err) {
  try {
    print(`uncaught:${String(err)}`);
  } catch {
    print("uncaught:<unprintable>");
  }
}

// Async failures fail the execution instead of exiting the child.
let asyncFailure = false;
const onAsyncFailure = err => {
  asyncFailure = true;
  reportUncaught(err);
};
function installAsyncFailureHandlers() {
  removeListener("uncaughtException", onAsyncFailure);
  removeListener("unhandledRejection", onAsyncFailure);
  addListener("uncaughtException", onAsyncFailure);
  addListener("unhandledRejection", onAsyncFailure);
}

// Timers a script leaves behind must not fire during later scripts.
const pendingTimers = new Map();
function tracked(set, clear) {
  return function () {
    const timer = apply(set, this, arguments);
    apply(mapSet, pendingTimers, [timer, clear]);
    return timer;
  };
}
globalThis.setTimeout = tracked(setTimeout, clearTimeout);
globalThis.setInterval = tracked(setInterval, clearInterval);
globalThis.setImmediate = tracked(setImmediate, clearImmediate);
function clearPendingTimers() {
  apply(mapForEach, pendingTimers, [(clear, timer) => clear(timer)]);
  apply(mapClear, pendingTimers, []);
}

// ============================================================================
// REPRL Protocol Loop
// ============================================================================

// Verify we're running under Fuzzilli before starting REPRL loop
// The native side should have already checked, but double-check here
try {
  // Try to stat fd 100 to see if it exists
  fs.fstatSync(REPRL_CRFD);
} catch {
  // FD doesn't exist - not running under Fuzzilli
  console.error("ERROR: REPRL file descriptors not available. Must run under Fuzzilli.");
  process.exit(1);
}

// Send HELO handshake
fs.writeSync(REPRL_CWFD, Buffer.from("HELO"));

// Read HELO response
const response = Buffer.alloc(4);
const responseBytes = fs.readSync(REPRL_CRFD, response, 0, 4, null);
if (responseBytes !== 4) {
  throw new Error(`REPRL handshake failed: expected 4 bytes, got ${responseBytes}`);
}

// Main REPRL loop. setImmediate gives the event loop one turn per script.
function runNextScript() {
  // Read command
  const cmd = Buffer.alloc(4);
  const cmd_n = fs.readSync(REPRL_CRFD, cmd, 0, 4, null);

  if (cmd_n === 0) {
    // EOF
    return exit(0);
  }

  if (cmd_n !== 4 || cmd.toString() !== "exec") {
    console.error(`Invalid REPRL command: expected 'exec', got ${cmd.toString()}`);
    return exit(1);
  }

  // Read script size (8 bytes, little-endian)
  const size_bytes = Buffer.alloc(8);
  fs.readSync(REPRL_CRFD, size_bytes, 0, 8, null);
  const script_size = Number(size_bytes.readBigUInt64LE(0));

  // Read script data from REPRL_DRFD
  const script_data = Buffer.alloc(script_size);
  let total_read = 0;
  while (total_read < script_size) {
    const n = fs.readSync(REPRL_DRFD, script_data, total_read, script_size - total_read, null);
    if (n === 0) break;
    total_read += n;
  }

  const script = script_data.toString("utf8");

  // Execute script
  let exit_code = 0;
  installAsyncFailureHandlers();
  try {
    // Use indirect eval to execute in global scope
    (0, eval)(script);
  } catch (_e) {
    reportUncaught(_e);
    exit_code = 1;
  }

  setImmediate(finishScript, exit_code);
}

function finishScript(exit_code) {
  clearPendingTimers();
  if (asyncFailure) {
    asyncFailure = false;
    exit_code = 1;
  }

  // Send status back (4 bytes: exit code in REPRL format)
  // Format: lower 8 bits = signal number, next 8 bits = exit code
  const status = exit_code << 8;
  const status_bytes = Buffer.alloc(4);
  status_bytes.writeUInt32LE(status, 0);
  fs.writeSync(REPRL_CWFD, status_bytes);

  resetCoverage();
  runNextScript();
}

setImmediate(runNextScript);
