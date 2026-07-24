import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Archive",
    construct: true,
    finalize: true,
    configurable: false,
    JSType: "0b11101110",
    klass: {
      write: {
        fn: "write",
        length: 2,
      },
    },
    proto: {
      append: {
        fn: "append",
        length: 2,
      },
      stream: {
        fn: "stream",
        length: 0,
      },
      end: {
        fn: "end",
        length: 0,
      },
      extract: {
        fn: "extract",
        length: 2,
      },
      blob: {
        fn: "blob",
        length: 0,
      },
      bytes: {
        fn: "bytes",
        length: 0,
      },
      files: {
        fn: "files",
        length: 0,
      },
    },
  }),
];
