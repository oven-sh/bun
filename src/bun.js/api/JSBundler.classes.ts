import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Transpiler",
    construct: true,
    finalize: true,
    hasPendingActivity: false,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      scanImports: {
        fn: "scanImports",
        length: 2,
      },
      scan: {
        fn: "scan",
        length: 2,
      },
      transform: {
        fn: "transform",
        length: 2,
      },
      transformSync: {
        fn: "transformSync",
        length: 2,
      },
    },
  }),
  define({
    name: "BuildArtifact",
    noConstructor: true,
    finalize: true,
    hasPendingActivity: false,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      text: { fn: "getText" },
      json: { fn: "getJSON" },
      arrayBuffer: { fn: "getArrayBuffer" },
      slice: { fn: "getSlice", length: 2 },
      stream: { fn: "getStream", length: 1 },

      path: { getter: "getPath", cache: true },
      size: { getter: "getSize" },
      hash: { getter: "getHash", cache: true },
      sourcemap: { getter: "getSourceMap", cache: true },
      loader: { getter: "getLoader", cache: true },
      type: { getter: "getMimeType", cache: true },
      kind: { getter: "getOutputKind", cache: true },
    },
  }),
  define({
    name: "WatchBuildResult",
    noConstructor: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      stop: {
        fn: "stop",
        length: 0,
      },
      on: {
        fn: "on",
        length: 2,
      },
      outputs: {
        getter: "getOutputs",
      },
      success: {
        getter: "getSuccess",
      },
      logs: {
        getter: "getLogs",
      },
      url: {
        getter: "getUrl",
        cache: true,
      },
      import: {
        fn: "doImport",
        length: 1,
      },
    },
  }),
];
