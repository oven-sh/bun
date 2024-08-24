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
      bytesRead: { // deprecated
        value: "bytesWritten",
      },
      closed: {
        getter: "getClosed",
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
      bytesRead: { // deprecated
        value: "bytesWritten",
      },
      closed: {
        getter: "getClosed",
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
      bytesRead: { // deprecated
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
      bytesRead: { // deprecated
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
    },
  }),

  define({
    name: "GzipEncoder",
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
      bytesRead: { // deprecated
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
    },
  }),
  define({
    name: "GzipDecoder",
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
      bytesRead: { // deprecated
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
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
      bytesRead: { // deprecated
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
      reset: {
        fn: "reset",
        length: 0,
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
      bytesRead: { // deprecated
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
    },
  }),
];
