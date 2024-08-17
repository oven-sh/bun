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

        DOMJIT: {
          returns: "JSString",
          args: ["JSUint8Array"],
        },
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

        DOMJIT: {
          returns: "JSUint8Array",
          args: ["JSString"],
        },
      },
      flush: {
        fn: "flush",
        length: 0,

        DOMJIT: {
          returns: "JSUint8Array",
          args: [],
        },
      },
    },
  }),
];
