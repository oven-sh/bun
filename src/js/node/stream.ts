// Hardcoded module "node:stream" / "readable-stream"
const exports = require("internal/stream");

$debug("node:stream loaded");

exports.eos = require("internal/streams/end-of-stream");

export default exports;
