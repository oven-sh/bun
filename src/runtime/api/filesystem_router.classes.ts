import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "FrameworkFileSystemRouter",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    proto: {
      toJSON: {
        fn: "toJSON",
        length: 0,
      },
      match: {
        fn: "match",
        length: 1,
      },
    },
    klass: {},
  }),
];
