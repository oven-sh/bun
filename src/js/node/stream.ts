// Hardcoded module "node:stream" / "readable-stream"
const EE = require("node:events").EventEmitter;
const exports = require("internal/stream");

$debug("node:stream loaded");

exports.eos = require("internal/streams/end-of-stream");
exports.EventEmitter = EE;

export default exports;
