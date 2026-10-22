import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;
const unlink = { ...method, args: { options: b.any }, rustName: "do_unlink", length: 0 } as const;

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
    arrayBuffer: { ...method, rustName: "get_array_buffer" },
    bytes: { ...method, rustName: "get_bytes" },
    delete: unlink,
    exists: { ...method, rustName: "get_exists" },
    formData: { ...method, rustName: "get_form_data" },
    /** `new Bun.Image(this, options)` */
    image: { ...method, args: { options: b.any }, passThis: true, rustName: "do_image", length: 0 },
    json: { ...method, rustName: "get_json" },
    lastModified: { getter: b.f64 },
    name: { getter: b.any, setter: true, cache: true, passThis: true, ...js },
    size: { getter: b.f64 },
    slice: { ...method, args: { start: b.any, end: b.any, contentType: b.any }, rustName: "get_slice", length: 2 },
    stat: { ...method, rustName: "get_stat" },
    stream: { ...method, args: { chunkSize: b.any }, passThis: true, rustName: "get_stream" },
    text: { ...method, rustName: "get_text" },
    type: { getter: b.any, capability: "js" },
    unlink,
    write: { ...method, args: { data: b.any, options: b.any }, rustName: "do_write" },
    writer: { ...method, args: { options: b.any }, rustName: "get_writer" },
  },
});
