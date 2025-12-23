import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Archive",
    construct: true,
    finalize: true,
    configurable: false,
    JSType: "0b11101110",
    klass: {
      from: {
        fn: "from",
        length: 1,
      },
      write: {
        fn: "write",
        length: 2,
      },
    },
    proto: {
      extract: {
        fn: "extract",
        length: 1,
      },
      blob: {
        fn: "blob",
        length: 1,
      },
      bytes: {
        fn: "bytes",
        length: 1,
      },
    },
  }),
];
