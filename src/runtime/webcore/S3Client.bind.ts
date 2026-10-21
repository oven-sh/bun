import * as b from "../../codegen/bindgen-lib.ts";

const method = { returns: b.any, capability: "js", throws: true, length: 2 } as const;
const onPath = { ...method, args: { path: b.any, options: b.any } } as const;

/** `S3Client.write(..)` uses the credentials of the environment, `client.write(..)` those of the client. */
const members = (prefix: "" | "static_") =>
  ({
    delete: { ...onPath, rustName: `${prefix}unlink` },
    exists: { ...onPath, rustName: `${prefix}exists` },
    file: { ...onPath, rustName: `${prefix}file` },
    list: { ...method, args: { input: b.any, options: b.any }, rustName: `${prefix}list_objects` },
    /** `presign(path, undefined)` is not `presign(path)`: see `presign_args`. */
    presign: { ...method, args: { args: b.any.variadic }, rustName: `${prefix}presign` },
    size: { ...onPath, rustName: `${prefix}size` },
    stat: { ...onPath, rustName: `${prefix}stat` },
    unlink: { ...onPath, rustName: `${prefix}unlink` },
    write: { ...method, args: { path: b.any, data: b.any, options: b.any }, rustName: `${prefix}write` },
  }) as const;

export const S3Client = b.class({
  rustPath: "crate::webcore::s3_client::S3Client",
  configurable: false,
  construct: { args: { options: b.any }, capability: "js", throws: true, length: 0 },
  static: members("static_"),
  proto: members(""),
});
