import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "Transpiler",
    rustPath: "crate::api::js_transpiler::JSTranspiler",
    construct: true,
    refCounted: true,
    hasPendingActivity: false,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      scanImports: {
        fn: "scanImports",
        returns: "Array",
        checkedAtRuntime: true,
        length: 2,
      },
      scan: {
        fn: "scan",
        returns: "object",
        checkedAtRuntime: true,
        length: 2,
      },
      transform: {
        fn: "transform",
        returns: "Promise",
        checkedAtRuntime: true,
        length: 2,
      },
      transformSync: {
        fn: "transformSync",
        returns: "string",
        checkedAtRuntime: true,
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
      text: { fn: "getText", returns: "Promise", checkedAtRuntime: true },
      json: { fn: "getJSON", returns: "Promise", checkedAtRuntime: true },
      arrayBuffer: { fn: "getArrayBuffer", returns: "Promise", checkedAtRuntime: true },
      slice: { fn: "getSlice", returns: "Blob", checkedAtRuntime: true, length: 2 },
      stream: { fn: "getStream", returns: "ReadableStream", checkedAtRuntime: true, length: 1 },

      path: { getter: "getPath", type: "string", checkedAtRuntime: true, cache: true },
      size: { getter: "getSize", type: "number" },
      hash: { getter: "getHash", type: "string", checkedAtRuntime: true, cache: true },
      sourcemap: { getter: "getSourceMap", type: "BuildArtifact | null", checkedAtRuntime: true, cache: true },
      loader: { getter: "getLoader", type: "string", checkedAtRuntime: true, cache: true },
      type: { getter: "getMimeType", type: "string", checkedAtRuntime: true, cache: true },
      kind: { getter: "getOutputKind", type: "string", checkedAtRuntime: true, cache: true },
    },
  }),
];
