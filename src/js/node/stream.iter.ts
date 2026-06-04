// Hardcoded module "node:stream/iter"
// Port of Node.js lib/stream/iter.js (the experimental iterable streams API).
// The push/duplex factories, broadcast/share multi-consumer helpers, merge(),
// and classic-stream interop are not ported yet.

// Protocol symbols
const {
  toStreamable,
  toAsyncStreamable,
  broadcastProtocol,
  shareProtocol,
  shareSyncProtocol,
  drainableProtocol,
} = require("internal/streams/iter/types");

// Factories
const { from, fromSync } = require("internal/streams/iter/from");

// Pipelines
const { pull, pullSync, pipeTo, pipeToSync } = require("internal/streams/iter/pull");

// Consumers
const {
  bytes,
  bytesSync,
  text,
  textSync,
  arrayBuffer,
  arrayBufferSync,
  array,
  arraySync,
  tap,
  tapSync,
  ondrain,
} = require("internal/streams/iter/consumers");

process.emitWarning("stream/iter is an experimental feature and might change at any time", "ExperimentalWarning");

/**
 * Stream namespace - unified access to all stream functions.
 */
const Stream = Object.freeze({
  // Factories
  from,
  fromSync,

  // Pipelines
  pull,
  pullSync,

  // Pipe to destination
  pipeTo,
  pipeToSync,

  // Consumers (async)
  bytes,
  text,
  arrayBuffer,
  array,

  // Consumers (sync)
  bytesSync,
  textSync,
  arrayBufferSync,
  arraySync,

  // Utilities
  tap,
  tapSync,

  // Drain utility for event source integration
  ondrain,

  // Protocol symbols
  toStreamable,
  toAsyncStreamable,
  broadcastProtocol,
  shareProtocol,
  shareSyncProtocol,
  drainableProtocol,
});

export default {
  // The Stream namespace
  Stream,

  // Protocol symbols
  toStreamable,
  toAsyncStreamable,
  broadcastProtocol,
  shareProtocol,
  shareSyncProtocol,
  drainableProtocol,

  // Factories
  from,
  fromSync,

  // Pipelines
  pull,
  pullSync,
  pipeTo,
  pipeToSync,

  // Consumers (async)
  bytes,
  text,
  arrayBuffer,
  array,

  // Consumers (sync)
  bytesSync,
  textSync,
  arrayBufferSync,
  arraySync,

  // Utilities
  tap,
  tapSync,
  ondrain,
};
