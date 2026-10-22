import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any.returning("Promise"), ...js } as const;
const unlink = { ...method, args: { options: b.any }, length: 0 } as const;

export const Blob = b.class({
  rustPath: "bun_jsc::webcore_types::Blob",
  refCounted: true,
  final: false,
  overridesToJS: true,
  rustTraits: ["crate::webcore::blob::BlobExt"],
  estimatedSize: true,
  types: [table.viewType("Blob"), table.exactType("$Bindgen.Blob")],
  lockedObjects: ["prototype"],
  construct: { args: { parts: b.any, options: b.any }, ...js, length: 0 },
  internalFields: ["stream"],
  proto: {
    arrayBuffer: method,
    bytes: method,
    delete: { ...unlink, rustName: "unlink" },
    exists: method,
    formData: method,
    /** `new Bun.Image(this, options)` */
    image: { ...js, args: { options: b.any }, returns: b.any.returning("Image"), passThis: true, length: 0 },
    json: { ...method, typedResultForm: { form: "ParsedBody", source: "this" } },
    lastModified: { getter: b.f64 },
    name: { getter: b.any.returning("string", "undefined", "null"), setter: true, cache: true, passThis: true, ...js },
    size: { getter: b.f64 },
    slice: {
      ...js,
      args: { start: b.any, end: b.any, contentType: b.any },
      returns: b.any.returning("Blob"),
      length: 2,
    },
    stat: { returns: b.any.returning("Promise", "undefined"), ...js },
    stream: { ...js, args: { chunkSize: b.any }, returns: b.any.returning("ReadableStream"), passThis: true },
    text: method,
    type: { getter: b.any.returning("string"), capability: "js" },
    unlink,
    write: { ...method, args: { data: b.any, options: b.any } },
    writer: { ...js, args: { options: b.any }, returns: b.any.returning("object") },
  },
});
