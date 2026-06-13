import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "CompressionStreamTransformer",
    construct: true,
    finalize: true,
    estimatedSize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      transform: {
        fn: "transform",
        length: 2,
      },
      close: {
        fn: "close",
        length: 0,
      },
    },
  }),
];
