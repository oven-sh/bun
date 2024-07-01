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
      write: {
        fn: "write",
        length: 2,
      },
      writeSync: {
        fn: "writeSync",
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
      write: {
        fn: "write",
        length: 2,
      },
      writeSync: {
        fn: "writeSync",
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
      write: {
        fn: "write",
        length: 2,
      },
      writeSync: {
        fn: "writeSync",
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
      write: {
        fn: "write",
        length: 2,
      },
      writeSync: {
        fn: "writeSync",
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
