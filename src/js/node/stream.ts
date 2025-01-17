// Hardcoded module "node:stream" / "readable-stream"

const { kEnsureConstructed, kGetNativeReadableProto } = require("internal/shared");
const EE = require("node:events").EventEmitter;
const exports = require("internal/stream");

$debug("node:stream loaded");

var nativeReadableStreamPrototypes = {
  0: undefined,
  1: undefined,
  2: undefined,
  3: undefined,
  4: undefined,
  5: undefined,
};

function getNativeReadableStreamPrototype(nativeType, Readable) {
  return (nativeReadableStreamPrototypes[nativeType] ??= require("internal/streams/nativereadable")());
}

/** --- Bun native stream wrapper ---  */

exports[kGetNativeReadableProto] = getNativeReadableStreamPrototype;
exports.NativeWritable = require("internal/streams/nativewritable");

const {
  newStreamReadableFromReadableStream: _ReadableFromWeb,
  _ReadableFromWeb: _ReadableFromWebForUndici,
} = require("internal/webstreams_adapters");

exports[Symbol.for("::bunternal::")] = { _ReadableFromWeb, _ReadableFromWebForUndici, kEnsureConstructed };
exports.eos = require("internal/streams/end-of-stream");
exports.EventEmitter = EE;

export default exports;
