import { define } from "../../codegen/class-definitions";

function source(name) {
  return define({
    name: name + "InternalReadableStreamSource",
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
