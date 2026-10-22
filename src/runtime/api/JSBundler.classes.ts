import { define } from "../../codegen/class-definitions.ts";

export default [
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
      // Not inherited from `Blob.prototype` (#16374): an output has only the Blob members listed here.
      text: { fn: "getText" },
      json: { fn: "getJSON" },
      arrayBuffer: { fn: "getArrayBuffer" },
      slice: { fn: "getSlice", length: 2 },
      stream: { fn: "getStream", length: 1 },
      bytes: { fn: "getBytes", async: true },
      image: { fn: "doImage", length: 0 },

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
