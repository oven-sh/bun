// Port of Node.js lib/internal/streams/iter/types.js
// Protocol symbols and internal sentinels for the iterable streams API.

/**
 * Symbol for sync value-to-streamable conversion protocol.
 */
const toStreamable = Symbol.for("Stream.toStreamable");

/**
 * Symbol for async value-to-streamable conversion protocol.
 */
const toAsyncStreamable = Symbol.for("Stream.toAsyncStreamable");

/**
 * Symbol for Broadcastable protocol - object can provide a Broadcast.
 */
const broadcastProtocol = Symbol.for("Stream.broadcastProtocol");

/**
 * Symbol for Shareable protocol - object can provide a Share.
 */
const shareProtocol = Symbol.for("Stream.shareProtocol");

/**
 * Symbol for SyncShareable protocol - object can provide a SyncShare.
 */
const shareSyncProtocol = Symbol.for("Stream.shareSyncProtocol");

/**
 * Symbol for Drainable protocol - object can signal when backpressure clears.
 */
const drainableProtocol = Symbol.for("Stream.drainableProtocol");

/**
 * Internal sentinel for validated stateful transforms. Not a public protocol
 * symbol - uses Symbol() not Symbol.for().
 */
const kValidatedTransform = Symbol("kValidatedTransform");

/**
 * Internal sentinel for validated sources that already yield valid
 * Uint8Array[] batches.
 */
const kValidatedSource = Symbol("kValidatedSource");

/**
 * Internal sentinel for writers whose sync write methods can return false
 * after accepting data as a backpressure signal.
 */
const kSyncWriteAccepted = Symbol("kSyncWriteAccepted");

/**
 * Internal sentinel for writers whose sync write methods may return false
 * after accepting data when backpressure is applied.
 */
const kSyncWriteAcceptedOnFalse = Symbol("kSyncWriteAcceptedOnFalse");

export default {
  broadcastProtocol,
  drainableProtocol,
  kSyncWriteAccepted,
  kSyncWriteAcceptedOnFalse,
  kValidatedSource,
  kValidatedTransform,
  shareProtocol,
  shareSyncProtocol,
  toAsyncStreamable,
  toStreamable,
};
