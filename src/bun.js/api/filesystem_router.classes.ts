import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "FileSystemRouter",
    construct: true,
    finalize: true,
    JSType: "0b11101110",

    proto: {
      match: {
        fn: "match",
        length: 1,
      },
      routes: {
        getter: "getRoutes",
        cache: true,
      },
      reload: {
        fn: "reload",
        length: 0,
      },
      origin: {
        getter: "getOrigin",
        cache: true,
      },
      style: {
        getter: "getStyle",
        cache: true,
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
        cache: true,
      },
      pathname: {
        getter: "getPathname",
        cache: true,
      },
      query: {
        getter: "getQuery",
        cache: true,
      },
      name: {
        getter: "getName",
        cache: true,
      },
      kind: {
        getter: "getKind",
        cache: true,
      },
      filePath: {
        getter: "getFilePath",
        cache: true,
      },
      // this is for compatibiltiy with bun-framework-next old versions
      scriptSrc: {
        getter: "getScriptSrc",
        cache: true,
      },
      src: {
        getter: "getScriptSrc",
        cache: "scriptSrc",
      },
    },
    klass: {},
  }),
];
