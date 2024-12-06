import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "NativeZlib",
    construct: true,
    noConstructor: false,
    wantsThis: true,
    finalize: true,
    configurable: false,
    // estimatedSize: true,
    klass: {},
    JSType: "0b11101110",
    values: ["callback"],

    proto: {
      init: { fn: "init" },
      write: { fn: "write" },
      writeSync: { fn: "writeSync" },
      params: { fn: "params" },
      reset: { fn: "reset" },
      close: { fn: "close" },
      onerror: { setter: "setOnError", getter: "getOnError" },
    },
  }),

  define({
    name: "NativeBrotli",
    construct: true,
    noConstructor: false,
    wantsThis: true,
    finalize: true,
    configurable: false,
    estimatedSize: true,
    klass: {},
    JSType: "0b11101110",
    values: ["callback"],

    proto: {
      init: { fn: "init" },
      write: { fn: "write" },
      writeSync: { fn: "writeSync" },
      params: { fn: "params" },
      reset: { fn: "reset" },
      close: { fn: "close" },
      onerror: { setter: "setOnError", getter: "getOnError" },
    },
  }),
];
