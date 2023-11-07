import { define } from "../scripts/class-definitions";

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
        fn: "scan",
        length: 1,
      },
      scanIter: {
        builtin: "globScanIterCodeGenerator",
        length: 1,
      },
      scanSync: {
        fn: "scanSync",
        length: 1,
      },
      match: {
        fn: "match",
        length: 1,
      },
    },
  }),
];
