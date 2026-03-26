// Comprehensive REPRL wrapper for Bun fuzzing with all runtime APIs exposed
// Based on workerd's approach to maximize fuzzing coverage
// https://bun.com/docs/runtime

const REPRL_CRFD = 100; // Control read FD
const REPRL_CWFD = 101; // Control write FD
const REPRL_DRFD = 102; // Data read FD

const fs = require("node:fs");

// Save bound method references before any fuzzed code can corrupt them.
// Fuzzed scripts run via eval in global scope and can corrupt any global
// variable (Buffer++), object property (Buffer.alloc = null), prototype
// method (Buffer.prototype.writeUInt32LE = null), or cached module export
// (require("node:fs").readSync = null). All of these break the REPRL
// protocol loop if they affect methods used outside the try/catch.
const _BufferAlloc = Buffer.alloc.bind(Buffer);
const _BufferFrom = Buffer.from.bind(Buffer);
const _Number = Number;
const _console_log = console.log.bind(console);
const _fsReadSync = fs.readSync.bind(fs);
const _fsWriteSync = fs.writeSync.bind(fs);
const _fstatSync = fs.fstatSync.bind(fs);
const _call = Function.prototype.call;
const _bufToString = _call.bind(Buffer.prototype.toString);

// Make common Node modules available
globalThis.require = require;
globalThis.__dirname = "/";
globalThis.__filename = "/fuzzilli.js";

// ============================================================================
// REPRL Protocol Loop
// ============================================================================

// Verify we're running under Fuzzilli before starting REPRL loop
// The Zig code should have already checked, but double-check here
try {
  // Try to stat fd 100 to see if it exists
  _fstatSync(REPRL_CRFD);
} catch {
  // FD doesn't exist - not running under Fuzzilli
  console.error("ERROR: REPRL file descriptors not available. Must run under Fuzzilli.");
  process.exit(1);
}

// Save resetCoverage after the FD check so a missing global (in non-Fuzzilli
// builds) doesn't mask the diagnostic error message above.
const _resetCoverage = resetCoverage;

// Pre-allocate buffers for the REPRL protocol status response. Using a raw
// Uint8Array with manual byte writes avoids all Buffer prototype methods and
// their internal dependencies (e.g. DataView), making the status write immune
// to any global/prototype corruption by fuzzed scripts.
const status_bytes = new Uint8Array(4);

// Send HELO handshake
_fsWriteSync(REPRL_CWFD, _BufferFrom("HELO"));

// Read HELO response
const response = _BufferAlloc(4);
const responseBytes = _fsReadSync(REPRL_CRFD, response, 0, 4, null);
if (responseBytes !== 4) {
  throw new Error(`REPRL handshake failed: expected 4 bytes, got ${responseBytes}`);
}

// Main REPRL loop
while (true) {
  // Read command
  const cmd = _BufferAlloc(4);
  const cmd_n = _fsReadSync(REPRL_CRFD, cmd, 0, 4, null);

  if (cmd_n === 0) {
    // EOF
    break;
  }

  if (cmd_n !== 4 || _bufToString(cmd) !== "exec") {
    throw new Error(`Invalid REPRL command: expected 'exec', got ${_bufToString(cmd)}`);
  }

  // Read script size (8 bytes, little-endian)
  const size_bytes = _BufferAlloc(8);
  _fsReadSync(REPRL_CRFD, size_bytes, 0, 8, null);

  // Read size as little-endian uint64 using raw byte access (avoids
  // Buffer.prototype.readBigUInt64LE and its internal dependencies).
  let script_size = 0;
  for (let i = 0; i < 8; i++) script_size += size_bytes[i] * 2 ** (i * 8);

  // Read script data from REPRL_DRFD
  const script_data = _BufferAlloc(script_size);
  let total_read = 0;
  while (total_read < script_size) {
    const n = _fsReadSync(REPRL_DRFD, script_data, total_read, script_size - total_read, null);
    if (n === 0) break;
    total_read += n;
  }

  const script = _bufToString(script_data, "utf8");

  // Execute script
  let exit_code = 0;
  try {
    // Use indirect eval to execute in global scope
    (0, eval)(script);
  } catch (_e) {
    // Print uncaught exception like workerd does
    try {
      _console_log(`uncaught:${_e}`);
    } catch {}
    exit_code = 1;
  }

  // Send status back (4 bytes: exit code in REPRL format)
  // Format: lower 8 bits = signal number, next 8 bits = exit code
  // Write as little-endian uint32 using raw byte access to avoid all
  // Buffer prototype methods and their internal globals (DataView etc).
  const status = exit_code << 8;
  status_bytes[0] = status & 0xff;
  status_bytes[1] = (status >> 8) & 0xff;
  status_bytes[2] = (status >> 16) & 0xff;
  status_bytes[3] = (status >> 24) & 0xff;
  _fsWriteSync(REPRL_CWFD, status_bytes);

  _resetCoverage();
}
