import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Pipe",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    values: ["onread"],
    proto: {
      open: { fn: "open", length: 1 },
      readStart: { fn: "readStart", length: 0 },
      readStop: { fn: "readStop", length: 0 },
      ref: { fn: "doRef", length: 0 },
      unref: { fn: "doUnref", length: 0 },
      close: { fn: "close", length: 1 },
      writeBuffer: { fn: "notsup", length: 2 },
      writeUtf8String: { fn: "notsup", length: 2 },
      shutdown: { fn: "notsup", length: 1 },
      bind: { fn: "notsup", length: 0 },
      listen: { fn: "notsup", length: 0 },
      connect: { fn: "notsup", length: 0 },
      fchmod: { fn: "notsup", length: 0 },
      onread: { getter: "getOnRead", setter: "setOnRead", this: true },

      bytesRead: { getter: "getBytesRead", enumerable: false },
      bytesWritten: { getter: "getBytesWritten", enumerable: false },
      fd: { getter: "getFd", enumerable: false },
      _externalStream: { getter: "getExternalStream", enumerable: false },
    },
  }),
];
