import { define } from "../../codegen/class-definitions";

const rustPaths = {
  Blob: "crate::webcore::byte_blob_loader::Source",
  File: "crate::webcore::file_reader::Source",
  Bytes: "crate::webcore::byte_stream::Source",
};

function source(name) {
  return define({
    name: name + "InternalReadableStreamSource",
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
        length: 1,
      },
      start: {
        fn: "startFromJS",
        length: 1,
      },
      updateRef: {
        fn: "updateRefFromJS",
        length: 1,
      },
      onClose: {
        getter: "getOnCloseFromJS",
        setter: "setOnCloseFromJS",
      },
      onDrain: {
        getter: "getOnDrainFromJS",
        setter: "setOnDrainFromJS",
      },
      cancel: {
        fn: "cancelFromJS",
        length: 1,
      },
      pull: {
        fn: "pullFromJS",
        length: 1,
      },
      isClosed: {
        getter: "getIsClosedFromJS",
      },
      ...(name !== "File"
        ? // Buffered versions
          // not implemented in File, yet.
          {
            text: {
              fn: "textFromJS",
              length: 0,
            },
            json: {
              fn: "jsonFromJS",
              length: 0,
            },
            arrayBuffer: {
              fn: "arrayBufferFromJS",
              length: 0,
            },
            blob: {
              fn: "blobFromJS",
              length: 0,
            },
            bytes: {
              fn: "bytesFromJS",
              length: 0,
            },
          }
        : {}),
      ...(name === "File"
        ? {
            setRawMode: {
              fn: "setRawModeFromJS",
              length: 1,
            },
            setFlowing: {
              fn: "setFlowingFromJS",
              length: 1,
            },
          }
        : {}),
    },
    klass: {},
    values: ["pendingPromise", "onCloseCallback", "onDrainCallback"],
  });
}

const sources = ["Blob", "File", "Bytes"];

export default sources.map(source);
