import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "FileLock",
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      unlock: { fn: "doUnlock", length: 0 },
      close: { fn: "doUnlock", length: 0 },
      "@@asyncDispose": { fn: "doUnlock", length: 0 },
      bytes: { fn: "doBytes", length: 1 },
      read: { fn: "doBytes", length: 1 },
      text: { fn: "doText", length: 1 },
      arrayBuffer: { fn: "doArrayBuffer", length: 1 },
      write: { fn: "doWrite", length: 1 },
      truncate: { fn: "doTruncate", length: 1 },
    },
  }),
];
