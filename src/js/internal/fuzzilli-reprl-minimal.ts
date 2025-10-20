// Minimal REPRL wrapper - working baseline
// Will add APIs step-by-step

const REPRL_CRFD = 100; // Control read FD
const REPRL_CWFD = 101; // Control write FD
const REPRL_DRFD = 102; // Data read FD
const REPRL_DWFD = 103; // Data write FD

const fs = require("node:fs");

// Disable process.abort to prevent false positive crashes from fuzzer
if (process && process.abort) {
  process.abort = undefined;
}

// Send HELO handshake FIRST - REPRLRun waits for this!
fs.writeSync(REPRL_CWFD, Buffer.from("HELO"));

// Read HELO response
const helo_response = Buffer.alloc(4);
fs.readSync(REPRL_CRFD, helo_response, 0, 4, null);

// Main REPRL loop
while (true) {
  console.error("[REPRL] Waiting for command...");
  // Read command
  const cmd = Buffer.alloc(4);
  const cmd_n = fs.readSync(REPRL_CRFD, cmd, 0, 4, null);
  console.error(`[REPRL] Read command: ${cmd.toString()}, bytes: ${cmd_n}`);

  if (cmd_n === 0) {
    break; // EOF
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
    (0, eval)(script);
  } catch (e) {
    console.log(`uncaught:${e}`);
    exit_code = 1;
  }

  // Send status back
  const status = exit_code << 8;
  const status_bytes = Buffer.alloc(4);
  status_bytes.writeUInt32LE(status, 0);
  fs.writeSync(REPRL_CWFD, status_bytes);
}

export default {};
