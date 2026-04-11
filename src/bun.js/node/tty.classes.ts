import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "TTY",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    values: ["onread"],
    proto: {
      readStart: { fn: "readStart", length: 0 },
      readStop: { fn: "readStop", length: 0 },
      setRawMode: { fn: "setRawMode", length: 1 },
      getWindowSize: { fn: "getWindowSize", length: 1 },
      ref: { fn: "doRef", length: 0 },
      unref: { fn: "doUnref", length: 0 },
      close: { fn: "close", length: 1 },
      onread: { getter: "getOnRead", setter: "setOnRead", this: true },

      bytesRead: { getter: "getBytesRead", enumerable: false },
      bytesWritten: { getter: "getBytesWritten", enumerable: false },
      fd: { getter: "getFd", enumerable: false },
      _externalStream: { getter: "getExternalStream", enumerable: false },
    },
  }),
];
