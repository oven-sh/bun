import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Glob",
    construct: true,
    finalize: true,
    hasPendingActivity: true,
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
];
