import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::js_bundler" });

const js = { capability: "js", throws: true } as const;
const read = { returns: b.any.returning("Promise"), ...js } as const;
const cached = { getter: b.any.returning("string"), cache: true, ...js } as const;

export const BuildArtifact = b.class({
  rustPath: "crate::api::js_bundler::BuildArtifact",
  internalFields: ["stream"],
  proto: {
    arrayBuffer: read,
    hash: cached,
    json: read,
    kind: cached,
    loader: cached,
    path: { getter: b.string.utf8, cache: true },
    size: { getter: b.f64 },
    slice: {
      ...js,
      args: { start: b.any, end: b.any, contentType: b.any },
      returns: b.any.returning("Blob"),
      length: 2,
    },
    /** `Bun.build` fills the field of an output that has a source map. */
    sourcemap: { getter: b.any.returning("BuildArtifact", "null"), cache: true, capability: "heap" },
    stream: { ...js, args: { chunkSize: b.any }, returns: b.any.returning("ReadableStream"), passThis: true },
    text: read,
    type: { getter: b.any.returning("string"), cache: true, capability: "js" },
  },
});

export const build = b.fn({
  ...js,
  args: { config: b.any },
  returns: b.any,
  rustPath: "crate::api::js_bundler::js_bundler::build",
});

export const workerLiveCount = b.fn({ returns: b.usize });
