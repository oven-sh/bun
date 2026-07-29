import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Glob",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      scan: {
        builtin: "globScanCodeGenerator",
        length: 1,
      },
      scanSync: {
        builtin: "globScanSyncCodeGenerator",
        length: 1,
      },
      __scan: {
        fn: "__scan",
        length: 1,
        // Wanted to use `resolve` and `resolveSync` but for some reason the
        // resolve symbol was not working, even though `resolveSync` was.
        privateSymbol: "pull",
      },
      __scanSync: {
        fn: "__scanSync",
        length: 1,
        privateSymbol: "resolveSync",
      },
      match: {
        fn: "match",
        length: 1,
      },
    },
  }),
  define({
    name: "GlobScanHandle",
    construct: false,
    noConstructor: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    proto: {
      __batch: {
        fn: "__batch",
        length: 0,
        privateSymbol: "pull",
      },
      __batchSync: {
        fn: "__batchSync",
        length: 0,
        privateSymbol: "resolveSync",
      },
      __close: {
        fn: "__close",
        length: 0,
        privateSymbol: "close",
      },
    },
  }),
];
