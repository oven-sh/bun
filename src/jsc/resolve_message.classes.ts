import { define } from "../codegen/class-definitions.ts";

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
        type: "string | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
      requireStack: {
        getter: "getRequireStack",
        type: "Array | undefined",
        checkedAtRuntime: true,
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
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      referrer: {
        getter: "getReferrer",
        type: "string | null",
        checkedAtRuntime: true,
        cache: true,
      },
      specifier: {
        getter: "getSpecifier",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      importKind: {
        getter: "getImportKind",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      position: {
        getter: "getPosition",
        type: "object | null",
        checkedAtRuntime: true,
        cache: true,
      },
      line: {
        getter: "getLine",
        type: "int32",
        pure: true,
      },

      column: {
        getter: "getColumn",
        type: "int32",
        pure: true,
      },
      ["@@toPrimitive"]: {
        fn: "toPrimitive",
        returns: "string | null",
        checkedAtRuntime: true,
        length: 1,
      },
      ["toString"]: {
        fn: "toString",
        returns: "string",
        checkedAtRuntime: true,
        length: 0,
      },
      ["toJSON"]: {
        fn: "toJSON",
        returns: "object",
        checkedAtRuntime: true,
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
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      position: {
        getter: "getPosition",
        type: "object | null",
        checkedAtRuntime: true,
        cache: true,
      },

      notes: {
        getter: "getNotes",
        type: "Array",
        checkedAtRuntime: true,
        cache: true,
      },

      line: {
        getter: "getLine",
        type: "int32",
        pure: true,
      },

      column: {
        getter: "getColumn",
        type: "int32",
        pure: true,
      },

      ["@@toPrimitive"]: {
        fn: "toPrimitive",
        returns: "string | null",
        checkedAtRuntime: true,
        length: 1,
      },
      ["toString"]: {
        fn: "toString",
        returns: "string",
        checkedAtRuntime: true,
        length: 0,
      },
      ["toJSON"]: {
        fn: "toJSON",
        returns: "object",
        checkedAtRuntime: true,
        length: 0,
      },
    },
  }),
];
