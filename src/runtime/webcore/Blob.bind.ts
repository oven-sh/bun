import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;
const unlink = { ...method, args: { options: b.any }, length: 0 } as const;

export const Blob = b.class({
  rustPath: "bun_jsc::webcore_types::Blob",
  refCounted: true,
  final: false,
  overridesToJS: true,
  rustTraits: ["crate::webcore::blob::BlobExt"],
  estimatedSize: true,
  construct: { args: { parts: b.any, options: b.any }, ...js, length: 0 },
  internalFields: ["stream"],
  proto: {
    arrayBuffer: method,
    bytes: method,
    delete: { ...unlink, rustName: "unlink" },
    exists: method,
    formData: method,
    /** `new Bun.Image(this, options)` */
    image: { ...method, args: { options: b.any }, passThis: true, length: 0 },
    json: method,
    lastModified: { getter: b.f64 },
    name: { getter: b.any, setter: true, cache: true, passThis: true, ...js },
    size: { getter: b.f64 },
    slice: { ...method, args: { start: b.any, end: b.any, contentType: b.any }, length: 2 },
    stat: method,
    stream: { ...method, args: { chunkSize: b.any }, passThis: true },
    text: method,
    type: { getter: b.any, capability: "js" },
    unlink,
    write: { ...method, args: { data: b.any, options: b.any } },
    writer: { ...method, args: { options: b.any } },
  },
});
