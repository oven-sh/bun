import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "Glob",
    construct: true,
    finalize: true,
    hasPendingActivity: false,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      match: {
        fn: "match",
        length: 1,
      },
      matchSync: {
        fn: "matchSync",
        length: 1,
      },
      matchString: {
        fn: "matchString",
        length: 1,
      },
    },
  }),
];
