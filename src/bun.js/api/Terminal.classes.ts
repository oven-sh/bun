import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Terminal",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    // Store callback references - prevents them from being GC'd while terminal is alive
    values: ["data", "drain", "exit"],
    proto: {
      write: {
        fn: "write",
        length: 1,
      },
      resize: {
        fn: "resize",
        length: 2,
      },
      setRawMode: {
        fn: "setRawMode",
        length: 1,
      },
      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      close: {
        fn: "close",
        length: 0,
      },
      "@@asyncDispose": {
        fn: "asyncDispose",
        length: 0,
      },
      closed: {
        getter: "getClosed",
      },
      inputFlags: {
        getter: "getInputFlags",
        setter: "setInputFlags",
      },
      outputFlags: {
        getter: "getOutputFlags",
        setter: "setOutputFlags",
      },
      localFlags: {
        getter: "getLocalFlags",
        setter: "setLocalFlags",
      },
      controlFlags: {
        getter: "getControlFlags",
        setter: "setControlFlags",
      },
    },
  }),
];
