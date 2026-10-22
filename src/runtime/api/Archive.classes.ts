import { define } from "../../codegen/class-definitions.ts";

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
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
    },
    proto: {
      extract: {
        fn: "extract",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      blob: {
        fn: "blob",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 0,
      },
      bytes: {
        fn: "bytes",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 0,
      },
      files: {
        fn: "files",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 0,
      },
    },
  }),
];
