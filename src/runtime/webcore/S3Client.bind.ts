import * as b from "../../codegen/bindgen-lib.ts";
import { PathLike } from "../node/node_fs_binding.bind.ts";
import { Blob, PathOrBlob, S3Options } from "./Blob.bind.ts";
import { BunWriteData } from "./BlobArguments.bind.ts";

const method = { returns: b.promise, capability: "js", throws: true } as const;

/** `missing` and `other` are not paths: each function reports them in its own words. */
export const S3Path = b.union({ missing: b.undefined, ...b.alternativesOf(PathLike), other: b.ignored });

/** Anything that is not an object is no options. */
const options = S3Options.otherAsNull;
/** `presign(path, undefined)` takes the ACL and the storage class of the file, `presign(path)` does not. */
export const S3PresignOptions = b.union({ options: S3Options, other: b.ignored }, { fromJS: true });
const looseText = b.string.utf8.owned.otherAsNull;

/** Read after the credentials are. */
export const ListObjectsInput = b.union({ missing: b.null, options: b.object, other: b.ignored });
export const ListObjectsOptions = b.dictionary(
  {
    continuationToken: looseText,
    delimiter: looseText,
    encodingType: looseText,
    fetchOwner: b.bool.loose.emptyStringAsNull,
    maxKeys: b.f64.otherAsNull,
    prefix: looseText,
    startAfter: looseText,
  },
  { allowArray: true, fromJS: true },
);

/** `S3Client.write(..)` uses the credentials of the environment, `client.write(..)` those of the client. */
const methods = (prefix: "" | "static_") => {
  const path = prefix === "" ? S3Path : PathOrBlob;
  const pathMethod = { ...method, args: { path, options } } as const;
  return {
    delete: { ...pathMethod, rustName: `${prefix}unlink` },
    exists: { ...pathMethod, rustName: `${prefix}exists` },
    file: { ...method, args: { path: S3Path, options }, returns: Blob, rustName: `${prefix}file` },
    list: { ...method, args: { input: ListObjectsInput, options }, rustName: `${prefix}list` },
    presign: {
      ...method,
      args: { path, options: S3PresignOptions.ifPassed },
      returns: b.string.local,
      length: 2,
      rustName: `${prefix}presign`,
    },
    /** A number for a `Blob` that is not an S3 file. */
    size: { ...pathMethod, returns: b.opaque, rustName: `${prefix}size` },
    stat: { ...pathMethod, rustName: `${prefix}stat` },
    unlink: { ...pathMethod, rustName: `${prefix}unlink` },
    write: { ...method, args: { path, data: BunWriteData, options }, length: 2, rustName: `${prefix}write` },
  } as const;
};

export const S3Client = b.class({
  rustPath: "crate::webcore::s3_client::S3Client",
  construct: { args: { options }, capability: "js", throws: true, length: 0 },
  proto: methods(""),
  static: methods("static_"),
});
