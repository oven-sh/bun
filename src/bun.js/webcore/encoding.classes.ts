import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "TextDecoder",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    klass: {},
    proto: {
      encoding: {
        getter: "getEncoding",
        cache: true,
      },
      fatal: {
        getter: "getFatal",
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
];
