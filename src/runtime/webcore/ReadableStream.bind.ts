import * as b from "../../codegen/bindgen-lib.ts";

const method = { returns: b.any, capability: "js", throws: true } as const;

const members = {
  cancel: { length: 1 },
  drain: { ...method, rustName: "drain_from_js", length: 1 },
  isClosed: { getter: b.bool },
  pull: { ...method, args: { view: b.any, flags: b.any }, passThis: true, rustName: "pull_from_js", length: 1 },
  start: { ...method, rustName: "start_from_js", length: 1 },
  updateRef: { args: { enable: b.any }, rustName: "update_ref_from_js" },
} as const;

/** Reads the whole stream. */
const buffered = {
  arrayBuffer: { ...method, rustName: "array_buffer_from_js" },
  blob: { ...method, rustName: "blob_from_js" },
  bytes: { ...method, rustName: "bytes_from_js" },
  json: { ...method, rustName: "json_from_js" },
  text: { ...method, rustName: "text_from_js" },
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

const source = { refCounted: true, finalize: true, memoryCost: true, configurable: false } as const;

/**
 * `owner` roots the GC cell of the peer producing into this source (`producer` backref) and `sinkOwner` the peer it
 * pipes into (`sink` backref): a chained transform needs both.
 * `closeAdapter` is the C++ JSNativeStreamSourceAdapter to notify from `on_close` (BunStreamSource.cpp sets it).
 */
const internalFields = ["pendingPromise", "closeAdapter", "owner", "sinkOwner"] as const;
/** The stream `ReadableStream__lockNative` locked, which `NewSource::end_locked_stream` closes or errors. */
const lockable = [...internalFields, "lockedStream"] as const;

/** Never gets a native sink. */
export const BlobInternalReadableStreamSource = b.class({
  ...source,
  rustPath: "crate::webcore::byte_blob_loader::Source",
  internalFields,
  proto: bufferedSource,
});

export const FileInternalReadableStreamSource = b.class({
  ...source,
  rustPath: "crate::webcore::file_reader::Source",
  internalFields: lockable,
  proto: {
    cancel: members.cancel,
    drain: members.drain,
    isClosed: members.isClosed,
    pull: members.pull,
    setFlowing: { args: { flag: b.any }, rustName: "set_flowing_from_js" },
    setRawMode: { returns: b.any, args: { flag: b.any }, capability: "js", rustName: "set_raw_mode_from_js" },
    start: members.start,
    updateRef: members.updateRef,
  },
});

export const BytesInternalReadableStreamSource = b.class({
  ...source,
  rustPath: "crate::webcore::byte_stream::Source",
  internalFields: lockable,
  proto: bufferedSource,
});
