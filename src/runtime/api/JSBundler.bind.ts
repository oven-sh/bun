import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;
const cached = { getter: b.any, cache: true, ...js } as const;

export const BuildArtifact = b.class({
  rustPath: "crate::api::js_bundler::BuildArtifact",
  internalFields: ["stream"],
  proto: {
    arrayBuffer: { ...method, rustName: "get_array_buffer" },
    hash: cached,
    json: { ...method, rustName: "get_json" },
    kind: { ...cached, rustName: "output_kind" },
    loader: cached,
    path: { getter: b.string.utf8, cache: true },
    size: { getter: b.f64 },
    slice: { ...method, args: { start: b.any, end: b.any, contentType: b.any }, rustName: "get_slice", length: 2 },
    /** `Bun.build` fills the field of an output that has a source map. */
    sourcemap: { getter: b.any, cache: true, capability: "heap", rustName: "source_map" },
    stream: { ...method, args: { chunkSize: b.any }, passThis: true, rustName: "get_stream" },
    text: { ...method, rustName: "get_text" },
    type: { getter: b.any, cache: true, capability: "js", rustName: "mime_type" },
  },
});
