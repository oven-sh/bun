import { define } from "../../codegen/class-definitions.ts";

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
        privateSymbol: "globScan",
      },
      __scanSync: {
        fn: "__scanSync",
        length: 1,
        privateSymbol: "globScanSync",
      },
      match: {
        fn: "match",
        length: 1,
      },
    },
  }),
];
