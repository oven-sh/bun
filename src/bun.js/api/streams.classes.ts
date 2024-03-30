import { define } from "../../codegen/class-definitions";

function source(name) {
  return define({
    name: name + "InternalReadableStreamSource",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
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
      ...(name === "File"
        ? {
            setRawMode: {
              fn: "setRawModeFromJS",
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
