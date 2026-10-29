import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { BuildArtifact } from "../api/JSBundler.bind.ts";
import { Image, ImageOptions } from "../image/Image.bind.ts";
import { PathOrFileDescriptor } from "../node/node_fs_binding.bind.ts";

export default b.module({ rustPath: "crate::webcore::blob" });

const js = { capability: "js", throws: true } as const;
const method = { returns: b.promise, ...js } as const;
const unlink = { ...method, args: { options: b.opaque }, length: 0 } as const;

/** Read after `parts` is converted. */
export const BlobPropertyBag = b.dictionary({ type: b.string.utf8.owned.otherAsNull }, { deferred: true });

export const Blob = b.class({
  rustPath: "bun_jsc::webcore_types::Blob",
  refCounted: true,
  final: false,
  overridesToJS: true,
  rustTraits: ["crate::webcore::blob::BlobExt"],
  estimatedSize: true,
  types: [table.viewType("Blob"), table.exactType("$Bindgen.Blob")],
  lockedObjects: ["prototype"],
  construct: { args: { parts: b.opaque, options: BlobPropertyBag.otherAsNull }, ...js, length: 0 },
  internalFields: ["stream"],
  proto: {
    arrayBuffer: method,
    bytes: method,
    delete: { ...unlink, rustName: "unlink" },
    exists: method,
    formData: method,
    /** `new Bun.Image(this, options)` */
    image: { ...js, args: { options: ImageOptions }, returns: Image, passThis: true, length: 0 },
    json: { ...method, typedResultForm: { form: "ParsedBody", source: "this" } },
    lastModified: { getter: b.f64 },
    name: {
      getter: b.opaque.returning("string", "undefined", "null"),
      setter: true,
      cache: true,
      passThis: true,
      ...js,
    },
    size: { getter: b.f64 },
    slice: {
      ...js,
      args: { start: b.opaque, end: b.opaque, contentType: b.opaque },
      returns: b.self,
      length: 2,
    },
    stat: { returns: b.opaque.returning("Promise", "undefined"), ...js },
    stream: { ...js, args: { chunkSize: b.opaque }, returns: b.object.returning("ReadableStream"), passThis: true },
    text: method,
    type: { getter: b.string.local, capability: "js" },
    unlink,
    write: { ...method, args: { data: b.opaque, options: b.opaque } },
    writer: { ...js, args: { options: b.opaque }, returns: b.object },
  },
});

/** A `Blob`, or an output of `Bun.build()`, which holds one. */
export const BlobOrBuildArtifact = b.union({ blob: Blob, buildArtifact: BuildArtifact });

/** Anything but a string is ignored, and so is `""`. `new String("")` sets the type to `""`. */
export const BlobType = b.union({ text: b.string, stringObject: b.string.allowStringObject, other: b.ignored });
/** What `Bun.file` reads of its options, unless the path is `s3://`. */
export const BunFileOptions = b.dictionary(
  { type: BlobType, lastModified: b.f64.loose.optional },
  { allowArray: true, nonObjectAsEmpty: true, fromJS: true },
);
/** `options` is also what an S3 file takes. */
export const file = b.fn({ ...js, args: { path: PathOrFileDescriptor, options: b.opaque }, returns: Blob });

export const PathOrBlob = b.union(
  { blob: Blob, buildArtifact: BuildArtifact, path: PathOrFileDescriptor },
  { fromJS: true },
);

/** What `Bun.write` itself reads of its options. */
export const BunWriteOptions = b.dictionary(
  { createPath: b.bool.emptyStringAsNull, mode: b.f64.nullable },
  { allowArray: true, fromJS: true, reportedAs: "options" },
);
/** `options` is also what a write to S3 takes. */
export const write = b.fn({ ...method, args: { destination: PathOrBlob, data: b.opaque, options: b.opaque } });
