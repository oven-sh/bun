import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "Transpiler",
    construct: true,
    finalize: true,
    hasPendingActivity: false,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      scanImports: {
        fn: "scanImports",
        length: 2,
      },
      scan: {
        fn: "scan",
        length: 2,
      },
      transform: {
        fn: "transform",
        length: 2,
      },
      transformSync: {
        fn: "transformSync",
        length: 2,
      },
    },
  }),

  define({
    name: "Bundler",
    construct: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      handle: {
        fn: "handleRequest",
        length: 2,
      },
      write: {
        fn: "write",
        length: 1,
      },
    },
  }),
];
