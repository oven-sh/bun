import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const read = { returns: b.any.returning("Promise"), ...js } as const;

/**
 * A Node stream passes `deliver`. Then the call returns no bytes: each result comes as `deliver(result, isClosed, failed)`
 * on a later turn of the event loop, as a libuv handle reports a read. `cancel` calls `callback()` the same way.
 */
const deliver = b.callable.optional;

const members = {
  cancel: {
    capability: "js",
    args: { reason: b.any.orAbsent, callback: deliver },
    passThis: true,
    length: 1,
    rustName: "cancel_from_js",
  },
  drain: { returns: b.any.returning("Uint8Array", "undefined"), ...js, length: 1 },
  isClosed: { getter: b.bool, pure: true },
  pull: {
    ...js,
    args: { view: b.any, flags: b.any, deliver },
    returns: b.any.returning("number", "boolean", "Promise", "Uint8Array", "undefined"),
    passThis: true,
    length: 1,
  },
  start: {
    ...js,
    args: { chunkSize: b.any.orAbsent, deliver },
    returns: b.any.returning("number", "boolean", "Uint8Array", "undefined"),
    passThis: true,
    length: 1,
  },
  updateRef: { args: { enable: b.bool.loose } },
} as const;

/** Reads the whole stream. */
const buffered = {
  arrayBuffer: read,
  blob: read,
  bytes: read,
  json: read,
  text: read,
} as const;

const bufferedSource = {
  arrayBuffer: buffered.arrayBuffer,
  blob: buffered.blob,
  bytes: buffered.bytes,
  cancel: members.cancel,
  drain: members.drain,
  isClosed: members.isClosed,
  json: buffered.json,
  pull: members.pull,
  start: members.start,
  text: buffered.text,
  updateRef: members.updateRef,
} as const;

const source = { refCounted: true, finalize: true, memoryCost: true } as const;

/** `owner` roots the peer that produces into this source, `sinkOwner` the peer it pipes into. `deliver` is the function of a Node stream that waits for a result. */
const internalFields = ["pendingPromise", "closeAdapter", "owner", "sinkOwner", "deliver"] as const;

/** A Blob source never gets a native sink. */
export const BlobInternalReadableStreamSource = b.class({
  ...source,
  rustPath: "crate::webcore::byte_blob_loader::Source",
  internalFields,
  proto: bufferedSource,
});

export const FileInternalReadableStreamSource = b.class({
  ...source,
  rustPath: "crate::webcore::file_reader::Source",
  /** `lockedStream` is the stream `ReadableStream__lockNative` locked, which `NewSource::end_locked_stream` closes or errors. */
  internalFields: [...internalFields, "lockedStream"],
  proto: {
    cancel: members.cancel,
    /** Drops the read that waits in the source for the `deliver` of a `pull`, with nothing read into it. `false`: none waits. */
    cancelPull: { returns: b.bool, capability: "js", passThis: true },
    drain: members.drain,
    isClosed: members.isClosed,
    pull: members.pull,
    setFlowing: { args: { flag: b.any }, capability: "js" },
    setRawMode: { args: { flag: b.any }, returns: b.any.returning("object", "undefined"), capability: "js" },
    start: members.start,
    updateRef: members.updateRef,
  },
});

export const BytesInternalReadableStreamSource = b.class({
  ...source,
  rustPath: "crate::webcore::byte_stream::Source",
  internalFields: [...internalFields, "lockedStream"],
  proto: bufferedSource,
});
