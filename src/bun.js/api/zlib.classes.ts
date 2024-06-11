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
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
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
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
    },
  }),

  define({
    name: "DeflateEncoder",
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
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
    },
  }),
  define({
    name: "DeflateDecoder",
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
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
    },
  }),
];
