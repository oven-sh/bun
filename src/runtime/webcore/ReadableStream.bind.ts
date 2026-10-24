import * as b from "../../codegen/bindgen-lib.ts";

const method = { returns: b.opaque, capability: "js", throws: true } as const;
const promise = { ...method, returns: b.promise } as const;

const members = {
  cancel: { capability: "js", length: 1, rustName: "cancel_from_js" },
  drain: { ...method, returns: b.bufferSource.optional, length: 1 },
  isClosed: { getter: b.bool },
  pull: {
    ...method,
    args: { view: b.bufferSource.allowShared.otherAsNull, flags: b.jsArray.otherAsNull },
    passThis: true,
    length: 1,
  },
  start: { ...method, length: 1 },
  updateRef: { args: { enable: b.bool.loose } },
} as const;

/** Reads the whole stream. */
const buffered = {
  arrayBuffer: promise,
  blob: promise,
  bytes: promise,
  json: promise,
  text: promise,
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

/** `owner` roots the peer that produces into this source, `sinkOwner` the peer it pipes into. */
const internalFields = ["pendingPromise", "closeAdapter", "owner", "sinkOwner"] as const;

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
    drain: members.drain,
    isClosed: members.isClosed,
    pull: members.pull,
    setFlowing: { args: { flag: b.bool.otherAsNull }, capability: "js" },
    /** Returns the error of a failure. */
    setRawMode: { args: { flag: b.bool.otherAsNull }, returns: b.object.optional, capability: "js" },
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
