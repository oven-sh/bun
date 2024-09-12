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
      transform: {
        fn: "transform",
        length: 2,
      },
      transformSync: {
        fn: "transformSync",
        length: 2,
      },
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
      bytesRead: {
        // deprecated
        value: "bytesWritten",
      },
      closed: {
        getter: "getClosed",
      },
      close: {
        fn: "close",
        length: 0,
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
      transform: {
        fn: "transform",
        length: 2,
      },
      transformSync: {
        fn: "transformSync",
        length: 2,
      },
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
      bytesRead: {
        // deprecated
        value: "bytesWritten",
      },
      closed: {
        getter: "getClosed",
      },
      close: {
        fn: "close",
        length: 0,
      },
    },
  }),
  define({
    name: "ZlibEncoder",
    construct: true,
    noConstructor: true,
    finalize: true,
    configurable: false,
    hasPendingActivity: true,
    klass: {},
    JSType: "0b11101110",
    values: ["callback"],
    proto: {
      transform: {
        fn: "transform",
        length: 2,
      },
      transformSync: {
        fn: "transformSync",
        length: 2,
      },
      transformWith: {
        fn: "transformWith",
        length: 4,
      },
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
      bytesRead: {
        // deprecated
        value: "bytesWritten",
      },
      level: {
        getter: "getLevel",
      },
      strategy: {
        getter: "getStrategy",
      },
      closed: {
        getter: "getClosed",
      },
      close: {
        fn: "close",
        length: 0,
      },
      params: {
        fn: "params",
        length: 3,
      },
    },
  }),
  define({
    name: "ZlibDecoder",
    construct: true,
    noConstructor: true,
    finalize: true,
    configurable: false,
    hasPendingActivity: true,
    klass: {},
    JSType: "0b11101110",
    values: ["callback"],

    proto: {
      transform: {
        fn: "transform",
        length: 2,
      },
      transformSync: {
        fn: "transformSync",
        length: 2,
      },
      transformWith: {
        fn: "transformWith",
        length: 4,
      },
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
      bytesRead: {
        // deprecated
        value: "bytesWritten",
      },
      level: {
        getter: "getLevel",
      },
      strategy: {
        getter: "getStrategy",
      },
      closed: {
        getter: "getClosed",
      },
      close: {
        fn: "close",
        length: 0,
      },
      params: {
        fn: "params",
        length: 3,
      },
    },
  }),
];
