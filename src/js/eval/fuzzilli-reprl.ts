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

// ============================================================================
// REPRL Protocol Loop
// ============================================================================

// Verify we're running under Fuzzilli before starting REPRL loop
// The Zig code should have already checked, but double-check here
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

// Main REPRL loop
while (true) {
  // Read command
  const cmd = Buffer.alloc(4);
  const cmd_n = fs.readSync(REPRL_CRFD, cmd, 0, 4, null);

  if (cmd_n === 0) {
    // EOF
    break;
  }

  if (cmd_n !== 4 || cmd.toString() !== "exec") {
    throw new Error(`Invalid REPRL command: expected 'exec', got ${cmd.toString()}`);
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
  try {
    // Use indirect eval to execute in global scope
    (0, eval)(script);
  } catch (_e) {
    // Print uncaught exception like workerd does
    console.log(`uncaught:${_e}`);
    exit_code = 1;
  }

  // Send status back (4 bytes: exit code in REPRL format)
  // Format: lower 8 bits = signal number, next 8 bits = exit code
  const status = exit_code << 8;
  const status_bytes = Buffer.alloc(4);
  status_bytes.writeUInt32LE(status, 0);
  fs.writeSync(REPRL_CWFD, status_bytes);

  resetCoverage();
}
