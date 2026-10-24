import * as b from "../../codegen/bindgen-lib.ts";
import { BuildArtifact } from "../api/JSBundler.bind.ts";
import { Image, ImageOptions } from "../image/Image.bind.ts";
import { PathOrFileDescriptor } from "../node/node_fs_binding.bind.ts";
import { BlobChunkSize, BlobSliceBound, BunWriteData } from "./BlobArguments.bind.ts";

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
/** `other` is `ToNumber`. */
export const S3Size = b.union({ missing: b.null, bigInt: b.i64.asIntN, number: b.f64, other: b.f64.loose });
/** `number` saturates and `other` is `ToInt32`. */
export const S3Count = b.union({ missing: b.null, bigInt: b.i64.asIntN, number: b.f64, other: b.i32.wrap });
export const S3Name = b.union({ missing: b.null, name: b.string.utf8.owned, other: b.ignored });
/** What a function that reads or writes a file reads of its options when the file is in S3. */
export const S3Options = b.dictionary(
  {
    accessKeyId: OptionText,
    secretAccessKey: OptionText,
    region: OptionText,
    endpoint: OptionText,
    bucket: OptionText,
    virtualHostedStyle: b.bool.optional,
    sessionToken: OptionText,
    pageSize: S3Size,
    partSize: S3Size,
    queueSize: S3Count,
    retry: S3Count,
    acl: S3Name,
    storageClass: S3Name,
    contentDisposition: OptionText,
    type: OptionText,
    contentEncoding: OptionText,
    requestPayer: b.bool.optional,
    /** `presign` */
    method: b.string.loose.emptyStringAsNull,
    expiresIn: S3Count,
    /** `blob.write` */
    createPath: b.bool.emptyStringAsNull,
  },
  { deferred: true, reportedAs: "options" },
);
const unlink = { ...method, args: { options: S3Options.otherAsNull }, length: 0 } as const;

export const WriteOptionsArgument = b.union({ missing: b.null, options: S3Options, other: b.opaque });

export const BlobParts = b.union({
  undefined: b.undefined,
  null: b.null,
  array: b.jsArray,
  buffer: b.bufferSource.allowShared,
  other: b.ignored,
});

export const BlobOptionsArgument = b.union({ missing: b.undefined, options: b.object, other: b.ignored });
/** Read after `parts` is converted. */
export const BlobPropertyBag = b.dictionary(
  { type: b.string.utf8.owned.otherAsNull },
  { allowArray: true, fromJS: true },
);
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
  construct: { args: { parts: BlobParts, options: BlobOptionsArgument }, ...js, length: 0 },
  internalFields: ["stream"],
  proto: {
    arrayBuffer: method,
    bytes: method,
    delete: { ...unlink, rustName: "unlink" },
    exists: method,
    formData: method,
    /** `new Bun.Image(this, options)` */
    image: { ...method, args: { options: ImageOptions }, returns: Image, passThis: true, length: 0 },
    json: method,
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
      args: { start: BlobSliceBound, end: BlobSliceBound, contentType: b.string.allowStringObject.view.otherAsNull },
      returns: b.self,
      length: 2,
    },
    stat: { ...method, returns: b.opaque },
    stream: { ...method, args: { chunkSize: BlobChunkSize }, returns: b.object, passThis: true },
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
export const BlobType = b.union({ text: b.string, stringObject: b.string.allowStringObject, ignored: b.ignored });
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

export const PathOrBlob = b.union({ blob: Blob, ...b.alternativesOf(PathOrFileDescriptor) }, { fromJS: true });

/** What `Bun.write` itself reads of its options. */
export const BunWriteOptions = b.dictionary(
  { createPath: b.bool.emptyStringAsNull, mode: b.f64.nullable },
  { allowArray: true, fromJS: true, reportedAs: "options" },
);
export const write = b.fn({
  ...method,
  args: { destination: PathOrBlob, data: BunWriteData, options: WriteOptionsArgument },
});
