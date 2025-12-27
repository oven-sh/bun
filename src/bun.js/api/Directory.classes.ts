import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Directory",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      path: {
        getter: "getPath",
        cache: true,
      },
      name: {
        getter: "getName",
        cache: true,
      },
      files: {
        fn: "files",
        length: 0,
      },
      filesSync: {
        fn: "filesSync",
        length: 0,
      },
    },
  }),
];
