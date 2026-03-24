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

// Pin the transpiler and String.prototype.replace before the loop so fuzz
// inputs cannot monkey-patch them between iterations.
const transpiler = new Bun.Transpiler({ target: "bun" });
const transpile = transpiler.transformSync.bind(transpiler);
const _replace = Function.prototype.call.bind(String.prototype.replace);

// Register runtime helpers on globalThis so transpiled `using` code works in eval.
// The transpiler lowers `using` to calls to these helpers and emits an
// `import from "bun:wrap"` that is invalid in eval context. Providing them as
// globals and stripping the import makes the transpiled output eval-safe.
// Pin with configurable:false so fuzz inputs cannot corrupt them.
Object.defineProperty(globalThis, "__using", {
  value: (stack, value, async) => {
    if (value != null) {
      if (typeof value !== "object" && typeof value !== "function")
        throw TypeError('Object expected to be assigned to "using" declaration');
      let dispose;
      if (async) dispose = value[Symbol.asyncDispose];
      if (dispose === void 0) dispose = value[Symbol.dispose];
      if (typeof dispose !== "function") throw TypeError("Object not disposable");
      stack.push([async, dispose, value]);
    } else if (async) {
      stack.push([async]);
    }
    return value;
  },
  writable: false,
  configurable: false,
  enumerable: false,
});
Object.defineProperty(globalThis, "__callDispose", {
  value: (stack, error, hasError) => {
    let fail = e =>
        (error = hasError
          ? new SuppressedError(e, error, "An error was suppressed during disposal")
          : ((hasError = true), e)),
      next = it => {
        while ((it = stack.pop())) {
          try {
            var result = it[1] && it[1].call(it[2]);
            if (it[0]) return Promise.resolve(result).then(next, e => (fail(e), next()));
          } catch (e) {
            fail(e);
          }
        }
        if (hasError) throw error;
      };
    return next();
  },
  writable: false,
  configurable: false,
  enumerable: false,
});

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
    // Transpile to lower `using` declarations before eval.
    // JSC's bytecode generator has a bug where a function with `using` and
    // a return as its last statement can produce a DFG graph where a catch
    // root block has predecessors, causing a validation crash.
    let code = script;
    try {
      code = transpile(script);
      // Strip `import ... from "bun:wrap"` — invalid in eval, helpers are on globalThis.
      // Normalize mangled helper names (e.g. __using_a1b2c3d4 → __using) to match globalThis.
      code = _replace(code, /import\s*\{[^}]*\}\s*from\s*"bun:wrap"\s*;\s*\n?/g, "");
      code = _replace(code, /(__callDispose|__using)_[a-z0-9]+/g, "$1");
    } catch {}
    // Use indirect eval to execute in global scope
    (0, eval)(code);
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
