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
      },
      __scanSync: {
        fn: "__scanSync",
        length: 1,
      },
      match: {
        fn: "match",
        length: 1,
      },
    },
  }),
];
