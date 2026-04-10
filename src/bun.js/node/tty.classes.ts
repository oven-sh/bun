import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "TTY",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    // GC-traced callback slots (Node sets handle.onread; net.ts sets ondrain)
    values: ["onread", "ondrain"],
    proto: {
      // Node tty_wrap surface
      readStart: { fn: "readStart", length: 0 },
      readStop: { fn: "readStop", length: 0 },
      setRawMode: { fn: "setRawMode", length: 1 },
      getWindowSize: { fn: "getWindowSize", length: 1 },
      ref: { fn: "doRef", length: 0 },
      unref: { fn: "doUnref", length: 0 },
      close: { fn: "close", length: 1 },
      onread: { getter: "getOnRead", setter: "setOnRead", this: true },
      ondrain: { getter: "getOnDrain", setter: "setOnDrain", this: true },

      // usocket-surface shim so existing net.ts touch-points work unchanged
      pause: { fn: "readStop", length: 0 },
      resume: { fn: "readStart", length: 0 },
      bytesWritten: { getter: "getBytesWritten" },
      write: { fn: "write", length: 2, privateSymbol: "write" },
      end: { fn: "end", length: 0, privateSymbol: "end" },

      // non-enumerable accessors for test-stream-base-prototype-accessors-enumerability.js
      bytesRead: { getter: "getBytesRead", enumerable: false },
      fd: { getter: "getFd", enumerable: false },
      _externalStream: { getter: "getExternalStream", enumerable: false },
    },
  }),
];
