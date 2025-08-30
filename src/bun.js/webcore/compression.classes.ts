import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "CompressionStreamEncoder",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      encode: {
        fn: "encode",
        length: 1,
      },
      flush: {
        fn: "flush",
        length: 0,
      },
    },
  }),
  define({
    name: "DecompressionStreamDecoder",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      decode: {
        fn: "decode",
        length: 1,
      },
      flush: {
        fn: "flush",
        length: 0,
      },
    },
  }),
];
