// Hardcoded module "node:stream/iter"
// Public entry point for the iterable streams API.
// Usage: require('stream/iter') or require('node:stream/iter')
// Requires: --experimental-stream-iter (gated at module resolution)

process.emitWarning("stream/iter is an experimental feature and might change at any time", "ExperimentalWarning");

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
const { push } = require("internal/streams/iter/push");
const { duplex } = require("internal/streams/iter/duplex");
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
  merge,
  ondrain,
} = require("internal/streams/iter/consumers");

// Classic stream interop (Node.js-specific, not part of the spec)
const { fromReadable, fromWritable, toReadable, toReadableSync, toWritable } = require("internal/streams/iter/classic");

// Multi-consumer
const { broadcast, Broadcast } = require("internal/streams/iter/broadcast");
const { share, shareSync, Share, SyncShare } = require("internal/streams/iter/share");

/**
 * Stream namespace - unified access to all stream functions.
 */
const Stream = Object.freeze({
  // Factories
  push,
  duplex,
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

  // Combining
  merge,

  // Multi-consumer (push model)
  broadcast,

  // Multi-consumer (pull model)
  share,
  shareSync,

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

  // Also export everything individually for destructured imports

  // Protocol symbols
  toStreamable,
  toAsyncStreamable,
  broadcastProtocol,
  shareProtocol,
  shareSyncProtocol,
  drainableProtocol,

  // Factories
  push,
  duplex,
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

  // Combining
  merge,

  // Multi-consumer
  broadcast,
  Broadcast,
  share,
  shareSync,
  Share,
  SyncShare,

  // Utilities
  tap,
  tapSync,
  ondrain,

  // Classic stream interop
  fromReadable,
  fromWritable,
  toReadable,
  toReadableSync,
  toWritable,
};
