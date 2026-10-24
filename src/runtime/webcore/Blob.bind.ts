import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { BuildArtifact } from "../api/JSBundler.bind.ts";

export default b.module({ rustPath: "crate::webcore::blob" });

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

/** A `Blob`, or an output of `Bun.build()`, which holds one. */
export const BlobOrBuildArtifact = b.union({ blob: Blob, buildArtifact: BuildArtifact });

/** Anything but a string is ignored, and so is `""`. `new String("")` sets the type to `""`. */
export const BlobType = b.union({ text: b.string, stringObject: b.string.allowStringObject, ignored: b.any });
/** What `Bun.file` reads of its options, unless the path is `s3://`. */
export const BunFileOptions = b.dictionary(
  { type: BlobType, lastModified: b.f64.loose.optional },
  { allowArray: true, nonObjectAsEmpty: true, fromJS: true },
);
/** `options` is also what an S3 file takes. */
export const file = b.fn({ ...js, args: { path: b.any, options: b.any }, returns: Blob });

/** What `Bun.write` itself reads of its options. */
export const BunWriteOptions = b.dictionary(
  { createPath: b.bool.emptyStringAsNull, mode: b.f64.nullable },
  { allowArray: true, fromJS: true, reportedAs: "options" },
);
/** `options` is also what a write to S3 takes. */
export const write = b.fn({ ...method, args: { destination: b.any, data: b.any, options: b.any } });
