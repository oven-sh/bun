import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "TextDecoder",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      encoding: {
        getter: "getEncoding",
        cache: true,
      },
      fatal: {
        getter: "getFatal",
      },
      ignoreBOM: {
        getter: "getIgnoreBOM",
      },

      decode: {
        fn: "decode",
        length: 1,
      },
    },
  }),
  define({
    name: "TextEncoderStreamEncoder",
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
];
