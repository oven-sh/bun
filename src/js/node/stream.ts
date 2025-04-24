// Hardcoded module "node:stream" / "readable-stream"
const EE = require("node:events").EventEmitter;
const exports = require("internal/stream");

$debug("node:stream loaded");

// Note: 'eos' is intentionally omitted here. The 'internal/stream' module
// already exports 'finished', which is the standard Node.js alias for
// the end-of-stream function. Adding 'eos' directly to the top-level
// export is not standard Node.js behavior for the 'stream' module.
// exports.eos = require("internal/streams/end-of-stream"); // This was causing TS2339

exports.EventEmitter = EE;

export default exports;