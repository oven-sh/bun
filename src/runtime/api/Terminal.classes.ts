import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "Terminal",
    construct: true,
    constructNeedsThis: true,
    refCounted: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    // Store callback references - prevents them from being GC'd while terminal is alive
    values: ["data", "drain", "exit"],
    proto: {
      write: {
        fn: "write",
        returns: "number",
        checkedAtRuntime: true,
        length: 1,
      },
      resize: {
        fn: "resize",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 2,
      },
      setRawMode: {
        fn: "setRawMode",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      ref: {
        fn: "doRef",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      unref: {
        fn: "doUnref",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      close: {
        fn: "close",
        returns: "undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      "@@asyncDispose": {
        fn: "asyncDispose",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 0,
      },
      closed: {
        getter: "getClosed",
        type: "boolean",
        pure: true,
      },
      inputFlags: {
        getter: "getInputFlags",
        type: "number",
        checkedAtRuntime: true,
        setter: "setInputFlags",
      },
      outputFlags: {
        getter: "getOutputFlags",
        type: "number",
        checkedAtRuntime: true,
        setter: "setOutputFlags",
      },
      localFlags: {
        getter: "getLocalFlags",
        type: "number",
        checkedAtRuntime: true,
        setter: "setLocalFlags",
      },
      controlFlags: {
        getter: "getControlFlags",
        type: "number",
        checkedAtRuntime: true,
        setter: "setControlFlags",
      },
    },
  }),
];
