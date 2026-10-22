import { define } from "../../codegen/class-definitions.ts";

const rustPaths = {
  Blob: "crate::webcore::byte_blob_loader::Source",
  File: "crate::webcore::file_reader::Source",
  Bytes: "crate::webcore::byte_stream::Source",
};

function source(name) {
  return define({
    name: name + "InternalReadableStreamSource",
    types: [
      { path: ["$ZigGeneratedClasses", name + "InternalReadableStreamSource"], isView: false, typeArguments: [] },
    ],
    rustPath: rustPaths[name],
    // R-2 Phase 3 opt-out: the codegen-facing wrapper `NewSource<C>` impl in
    // ReadableStream.rs still has `&mut self` host-fns (the embedded context
    // types — ByteStream/FileReader/ByteBlobLoader — are Cell-migrated, but
    // the generic wrapper is not yet). Remove once `NewSource<C>` is migrated.
    sharedThis: false,
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    memoryCost: true,
    proto: {
      drain: {
        fn: "drainFromJS",
        returns: "Uint8Array | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      start: {
        fn: "startFromJS",
        returns: "number | Uint8Array | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      updateRef: {
        fn: "updateRefFromJS",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      cancel: {
        fn: "cancelFromJS",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      pull: {
        fn: "pullFromJS",
        returns: "number | boolean | Promise | Uint8Array | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      isClosed: {
        getter: "getIsClosedFromJS",
        type: "boolean",
        pure: true,
      },
      ...(name !== "File"
        ? // Buffered versions
          // not implemented in File, yet.
          {
            text: {
              fn: "textFromJS",
              returns: "Promise",
              checkedAtRuntime: true,
              length: 0,
            },
            json: {
              fn: "jsonFromJS",
              returns: "Promise",
              checkedAtRuntime: true,
              length: 0,
            },
            arrayBuffer: {
              fn: "arrayBufferFromJS",
              returns: "Promise",
              checkedAtRuntime: true,
              length: 0,
            },
            blob: {
              fn: "blobFromJS",
              returns: "Promise",
              checkedAtRuntime: true,
              length: 0,
            },
            bytes: {
              fn: "bytesFromJS",
              returns: "Promise",
              checkedAtRuntime: true,
              length: 0,
            },
          }
        : {}),
      ...(name === "File"
        ? {
            setRawMode: {
              fn: "setRawModeFromJS",
              returns: "object | undefined",
              checkedAtRuntime: true,
              length: 1,
            },
            setFlowing: {
              fn: "setFlowingFromJS",
              returns: "undefined",
              checkedAtRuntime: true,
              length: 1,
            },
          }
        : {}),
    },
    klass: {},
    // `owner` roots the GC cell of the peer producing into this source
    // (`producer` backref); `sinkOwner` roots the peer it pipes into
    // (`sink` backref). A chained transform needs both.
    // `closeAdapter`: the C++ JSNativeStreamSourceAdapter to notify from `on_close` (BunStreamSource.cpp sets it).
    // `lockedStream`: the stream `ReadableStream__lockNative` locked, which `NewSource::end_locked_stream` closes or errors. A Blob source never gets a native sink.
    values: ["pendingPromise", "closeAdapter", "owner", "sinkOwner", ...(name !== "Blob" ? ["lockedStream"] : [])],
  });
}

const sources = ["Blob", "File", "Bytes"];

export default sources.map(source);
