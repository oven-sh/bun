import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "FileSystemRouter",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    proto: {
      match: {
        fn: "match",
        returns: "MatchedRoute | null",
        checkedAtRuntime: true,
        length: 1,
      },
      routes: {
        getter: "getRoutes",
        type: "object",
        checkedAtRuntime: true,
        cache: true,
      },
      reload: {
        fn: "reload",
        returns: "this",
        checkedAtRuntime: true,
        length: 0,
      },
      origin: {
        getter: "getOrigin",
        type: "string | null",
        checkedAtRuntime: true,
        cache: true,
      },
      style: {
        getter: "getStyle",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
    },
    klass: {},
  }),

  define({
    name: "FrameworkFileSystemRouter",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    proto: {
      toJSON: {
        fn: "toJSON",
        returns: "object",
        checkedAtRuntime: true,
        length: 0,
      },
      match: {
        fn: "match",
        returns: "object | null",
        checkedAtRuntime: true,
        length: 1,
      },
    },
    klass: {},
  }),

  define({
    name: "MatchedRoute",
    noConstructor: true,
    JSType: "0b11101110",
    construct: true,
    finalize: true,
    proto: {
      params: {
        getter: "getParams",
        type: "object",
        checkedAtRuntime: true,
        cache: true,
      },
      pathname: {
        getter: "getPathname",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      query: {
        getter: "getQuery",
        type: "object",
        checkedAtRuntime: true,
        cache: true,
      },
      name: {
        getter: "getName",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      kind: {
        getter: "getKind",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      filePath: {
        getter: "getFilePath",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      // this is for compatibiltiy with bun-framework-next old versions
      scriptSrc: {
        getter: "getScriptSrc",
        type: "string",
        checkedAtRuntime: true,
        cache: true,
      },
      src: {
        getter: "getScriptSrc",
        type: "string",
        checkedAtRuntime: true,
        cache: "scriptSrc",
      },
    },
    klass: {},
  }),
];
