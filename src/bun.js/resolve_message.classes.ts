import { define } from "./scripts/class-definitions";

export default [
  define({
    name: "ResolveMessage",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      message: {
        getter: "getMessage",
        cache: true,
      },
      code: {
        getter: "getCode",
        cache: true,
      },
      name: {
        value: "ResolveMessage",
      },
      level: {
        getter: "getLevel",
        cache: true,
      },
      referrer: {
        getter: "getReferrer",
        cache: true,
      },
      specifier: {
        getter: "getSpecifier",
        cache: true,
      },
      importKind: {
        getter: "getImportKind",
        cache: true,
      },
      position: {
        getter: "getPosition",
        cache: true,
      },
      ["@@toPrimitive"]: {
        fn: "toPrimitive",
        length: 1,
      },
      ["toString"]: {
        fn: "toString",
        length: 0,
      },
      ["toJSON"]: {
        fn: "toJSON",
        length: 0,
      },
    },
  }),

  define({
    name: "BuildMessage",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      message: {
        getter: "getMessage",
        cache: true,
      },
      name: {
        value: "BuildMessage",
      },
      level: {
        getter: "getLevel",
        cache: true,
      },
      position: {
        getter: "getPosition",
        cache: true,
      },
      ["@@toPrimitive"]: {
        fn: "toPrimitive",
        length: 1,
      },
      ["toString"]: {
        fn: "toString",
        length: 0,
      },
      ["toJSON"]: {
        fn: "toJSON",
        length: 0,
      },
    },
  }),
];
