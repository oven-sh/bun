import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Transpiler",
    rustPath: "crate::api::js_transpiler::JSTranspiler",
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
    // Per-class cached-stream slot. `Blob::get_stream` reads/writes the
    // receiver's slot; it must never reach through JSBlob's layout here.
    values: ["stream"],
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
];
