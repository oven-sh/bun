import { define } from "../codegen/class-definitions";

export default [
  define({
    name: "ResolveMessage",
    construct: true,
    finalize: true,
    configurable: false,
    // Error.prototype in the chain: userland checks `err instanceof Error`.
    prototypeBase: "Error",
    klass: {},
    JSType: "0b11101110",
    proto: {
      message: {
        getter: "getMessage",
        cache: true,
        writable: true,
      },
      code: {
        getter: "getCode",
        cache: true,
      },
      requireStack: {
        getter: "getRequireStack",
        cache: true,
      },
      stack: {
        getter: "getStack",
        cache: true,
        writable: true,
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
      line: {
        getter: "getLine",
      },

      column: {
        getter: "getColumn",
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
    // Error.prototype in the chain, matching ResolveMessage: userland checks
    // `err instanceof Error` on syntax/build failures too.
    prototypeBase: "Error",
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      message: {
        getter: "getMessage",
        cache: true,
        writable: true,
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

      notes: {
        getter: "getNotes",
        cache: true,
      },

      line: {
        getter: "getLine",
      },

      column: {
        getter: "getColumn",
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
