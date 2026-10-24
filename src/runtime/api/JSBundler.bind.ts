import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::js_bundler" });

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;
const cached = { getter: b.any, cache: true, ...js } as const;

export const BuildArtifact = b.class({
  rustPath: "crate::api::js_bundler::BuildArtifact",
  internalFields: ["stream"],
  proto: {
    arrayBuffer: method,
    hash: cached,
    json: method,
    kind: cached,
    loader: cached,
    path: { getter: b.string.utf8, cache: true },
    size: { getter: b.f64 },
    slice: { ...method, args: { start: b.any, end: b.any, contentType: b.any }, length: 2 },
    /** `Bun.build` fills the field of an output that has a source map. */
    sourcemap: { getter: b.any, cache: true, capability: "heap" },
    stream: { ...method, args: { chunkSize: b.any }, passThis: true },
    text: method,
    type: { getter: b.any, cache: true, capability: "js" },
  },
});

export const build = b.fn({
  ...method,
  args: { config: b.any },
  rustPath: "crate::api::js_bundler::js_bundler::build",
});

export const workerLiveCount = b.fn({ returns: b.usize });
