import * as b from "../../codegen/bindgen-lib.ts";

const method = { returns: b.any.returning("Promise"), capability: "js", throws: true } as const;
const pathMethod = { ...method, args: { path: b.any, options: b.any } } as const;

/** `S3Client.write(..)` uses the credentials of the environment, `client.write(..)` those of the client. */
const members = (prefix: "" | "static_") =>
  ({
    delete: { ...pathMethod, rustName: `${prefix}unlink` },
    exists: { ...pathMethod, rustName: `${prefix}exists` },
    file: { ...pathMethod, returns: b.any.returning("Blob"), rustName: `${prefix}file` },
    list: { ...method, args: { input: b.any, options: b.any }, rustName: `${prefix}list` },
    /** `presign(path, undefined)` is not `presign(path)`: see `presign_args`. */
    presign: {
      ...method,
      args: { args: b.any.variadic },
      returns: b.any.returning("string"),
      length: 2,
      rustName: `${prefix}presign`,
    },
    size: {
      ...pathMethod,
      returns: prefix === "" ? method.returns : b.any.returning("number", "Promise"),
      rustName: `${prefix}size`,
    },
    stat: { ...pathMethod, rustName: `${prefix}stat` },
    unlink: { ...pathMethod, rustName: `${prefix}unlink` },
    write: { ...method, args: { path: b.any, data: b.any, options: b.any }, length: 2, rustName: `${prefix}write` },
  }) as const;

export const S3Client = b.class({
  rustPath: "crate::webcore::s3_client::S3Client",
  construct: { args: { options: b.any }, capability: "js", throws: true, length: 0 },
  proto: members(""),
  static: members("static_"),
});
