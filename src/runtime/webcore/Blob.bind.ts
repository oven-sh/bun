import * as b from "../../codegen/bindgen-lib.ts";
import { BuildArtifact } from "../api/JSBundler.bind.ts";

export default b.module({ rustPath: "crate::webcore::blob" });

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

/** What `JSValue::as_class_ref::<Blob>` finds a `Blob` in. */
export const BlobOrBuildArtifact = b.union({ blob: Blob, buildArtifact: BuildArtifact });

/** What is not a string is not a type, and nor is `""`. A `String` object of it is the type `""`. */
export const BlobType = b.union({ text: b.string, stringObject: b.string.allowStringObject, ignored: b.any });
/** What `Bun.file` reads of its options, unless the path is `s3://`. */
export const BunFileOptions = b.dictionary(
  { type: BlobType, lastModified: b.f64.loose.optional },
  { allowArray: true, nonObjectAsEmpty: true, fromJS: true },
);
/** `options` is also what an S3 file takes. */
export const file = b.fn({ ...js, args: { path: b.any, options: b.any }, returns: Blob, length: 1 });

/** What `Bun.write` itself reads of its options. */
export const BunWriteOptions = b.dictionary(
  { createPath: b.bool.emptyStringAsNull, mode: b.f64.nullable },
  { allowArray: true, fromJS: true },
);
/** `options` is also what a write to S3 takes. */
export const write = b.fn({ ...method, args: { destination: b.any, data: b.any, options: b.any }, length: 1 });
