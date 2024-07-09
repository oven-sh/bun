import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "BrotliEncoder",
    construct: true,
    noConstructor: true,
    finalize: true,
    configurable: false,
    hasPendingActivity: true,
    klass: {},
    JSType: "0b11101110",
    values: ["callback"],
    proto: {
      encode: {
        fn: "encode",
        length: 2,
      },
      encodeSync: {
        fn: "encodeSync",
        length: 2,
      },
      end: {
        fn: "end",
        length: 2,
      },
      endSync: {
        fn: "endSync",
        length: 2,
      },
    },
  }),
  define({
    name: "BrotliDecoder",
    construct: true,
    noConstructor: true,
    finalize: true,
    configurable: false,
    hasPendingActivity: true,
    klass: {},
    JSType: "0b11101110",
    values: ["callback"],

    proto: {
      decode: {
        fn: "decode",
        length: 2,
      },
      decodeSync: {
        fn: "decodeSync",
        length: 2,
      },
      end: {
        fn: "end",
        length: 2,
      },
      endSync: {
        fn: "endSync",
        length: 2,
      },
    },
  }),
];
