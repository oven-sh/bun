import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "CompressionStreamTransformer",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      write: {
        fn: "write",
        length: 8,
      },
      close: {
        fn: "close",
        length: 0,
      },
    },
  }),
];
