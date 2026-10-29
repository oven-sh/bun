import * as b from "../../codegen/bindgen-lib.ts";
import { PathLike } from "../node/node_fs_binding.bind.ts";
import { Blob, PathOrBlob } from "./Blob.bind.ts";

const method = { returns: b.promise, capability: "js", throws: true } as const;

export const S3Path = b.union({ missing: b.undefined, path: PathLike });

/** `S3Client.write(..)` uses the credentials of the environment, `client.write(..)` those of the client. */
const members = (prefix: "" | "static_") => {
  const path = prefix === "" ? S3Path : PathOrBlob;
  const pathMethod = { ...method, args: { path, options: b.opaque } } as const;
  return {
    delete: { ...pathMethod, rustName: `${prefix}unlink` },
    exists: { ...pathMethod, rustName: `${prefix}exists` },
    file: { ...method, args: { path: S3Path, options: b.opaque }, returns: Blob, rustName: `${prefix}file` },
    list: { ...method, args: { input: b.opaque, options: b.opaque }, rustName: `${prefix}list` },
    /** `presign(path, undefined)` takes the ACL and the storage class of the file, `presign(path)` does not. */
    presign: {
      ...method,
      args: { path, options: b.opaque.ifPassed },
      returns: b.string.local,
      length: 2,
      rustName: `${prefix}presign`,
    },
    size: {
      ...pathMethod,
      returns: prefix === "" ? method.returns : b.opaque.returning("number", "Promise"),
      rustName: `${prefix}size`,
    },
    stat: { ...pathMethod, rustName: `${prefix}stat` },
    unlink: { ...pathMethod, rustName: `${prefix}unlink` },
    write: { ...method, args: { path, data: b.opaque, options: b.opaque }, length: 2, rustName: `${prefix}write` },
  } as const;
};

export const S3Client = b.class({
  rustPath: "crate::webcore::s3_client::S3Client",
  construct: { args: { options: b.opaque }, capability: "js", throws: true, length: 0 },
  proto: members(""),
  static: members("static_"),
});
