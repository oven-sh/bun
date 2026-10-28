import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { BuildArtifact } from "../api/JSBundler.bind.ts";
import { Image, ImageOptions } from "../image/Image.bind.ts";
import { PathOrFileDescriptor } from "../node/node_fs_binding.bind.ts";
import { BunWriteData, chunkSize } from "./BlobArguments.bind.ts";

export default b.module({ rustPath: "crate::webcore::blob" });

const js = { capability: "js", throws: true } as const;
const method = { returns: b.promise, ...js } as const;

/** `missing` and `""` leave the default. Each function reports `other` in its own words. */
export const OptionText = b.union({
  missing: b.null,
  text: b.string,
  stringObject: b.string.allowStringObject,
  other: b.opaque,
});
/** What a function that reads or writes a file reads of its options when the file is in S3. */
export const S3Options = b.dictionary(
  {
    accessKeyId: OptionText,
    secretAccessKey: OptionText,
    region: OptionText,
    endpoint: OptionText,
    bucket: OptionText,
    virtualHostedStyle: { type: b.bool.optional, expected: ["boolean"] },
    sessionToken: OptionText,
    pageSize: b.opaque.nullable,
    partSize: b.opaque.nullable,
    queueSize: b.opaque.nullable,
    retry: b.opaque.nullable,
    acl: { type: b.string.utf8.owned.nullable, expected: "acl must be a string" },
    storageClass: { type: b.string.utf8.owned.nullable, expected: "storageClass must be a string" },
    contentDisposition: OptionText,
    type: OptionText,
    contentEncoding: OptionText,
    requestPayer: { type: b.bool.optional, expected: ["boolean"] },
    /** `presign` */
    method: b.string.loose.emptyStringAsNull,
    expiresIn: b.opaque.nullable,
    /** `blob.write` */
    createPath: b.bool.emptyStringAsNull,
  },
  { deferred: true, reportedAs: "options" },
);
const unlink = { ...method, args: { options: S3Options.otherAsNull }, length: 0 } as const;

export const WriteOptionsArgument = b.union({ missing: b.null, options: S3Options, other: b.opaque });

/** Read after `parts` is converted. */
export const BlobPropertyBag = b.dictionary({ type: b.string.utf8.owned.otherAsNull }, { deferred: true });
export const BlobName = b.union(
  { missing: b.null, name: b.string.allowStringObject, other: b.ignored },
  { fromJS: true },
);

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
    image: { ...method, args: { options: ImageOptions }, returns: Image, passThis: true, length: 0 },
    json: { ...method, typedResultForm: { form: "ParsedBody", source: "this" } },
    lastModified: { getter: b.f64 },
    name: {
      getter: b.string.local.optional,
      setter: { type: b.opaque },
      cache: true,
      passThis: true,
      ...js,
    },
    size: { getter: b.f64 },
    slice: {
      ...method,
      args: { start: b.opaque, end: b.opaque, contentType: b.opaque },
      returns: b.self,
      length: 2,
    },
    stat: { ...method, returns: b.opaque.returning("Promise", "undefined") },
    stream: {
      ...method,
      args: { chunkSize },
      expected: { chunkSize: "chunkSize must be a number" },
      returns: b.object.returning("ReadableStream"),
      passThis: true,
      length: 1,
    },
    text: method,
    type: { getter: b.string.local, capability: "js" },
    unlink,
    write: { ...method, args: { data: BunWriteData, options: WriteOptionsArgument } },
    writer: { ...method, args: { options: WriteOptionsArgument }, returns: b.object },
  },
});

/** A `Blob`, or an output of `Bun.build()`, which holds one. */
export const BlobOrBuildArtifact = b.union({ blob: Blob, buildArtifact: BuildArtifact });

/** Anything but a string is ignored, and so is `""`. `new String("")` sets the type to `""`. */
export const BlobType = b.union({ text: b.string, stringObject: b.string.allowStringObject, other: b.ignored });
/** What `Bun.file` reads of its options, unless the path is `s3://`. */
export const BunFileOptions = b.dictionary(
  { type: BlobType, lastModified: b.f64.loose.optional },
  { allowArray: true, fromJS: true },
);
export const file = b.fn({
  ...js,
  args: { path: PathOrFileDescriptor, options: S3Options.otherAsNull },
  returns: Blob,
});

export const PathOrBlob = b.union(
  { blob: Blob, buildArtifact: BuildArtifact, path: PathOrFileDescriptor },
  { fromJS: true },
);

/** What `Bun.write` itself reads of its options. */
export const BunWriteOptions = b.dictionary(
  { createPath: b.bool.emptyStringAsNull, mode: b.f64.nullable },
  { allowArray: true, fromJS: true, reportedAs: "options" },
);
export const write = b.fn({
  ...method,
  args: { destination: PathOrBlob, data: BunWriteData, options: WriteOptionsArgument },
});
