import * as b from "../../codegen/bindgen-lib.ts";

const method = { returns: b.any, capability: "js", throws: true, length: 2 } as const;
/** `(path, ..)`, read through an `ArgumentsSlice`. */
const onPath = { ...method, args: { args: b.any.variadic } } as const;

/** `S3Client.write(..)` uses the credentials of the environment, `client.write(..)` those of the client. */
const members = (prefix: "" | "static_") =>
  ({
    delete: { ...onPath, rustName: `${prefix}unlink` },
    exists: { ...onPath, rustName: `${prefix}exists` },
    file: { ...onPath, rustName: `${prefix}file` },
    list: { ...method, args: { input: b.any, options: b.any }, rustName: `${prefix}list_objects` },
    presign: { ...onPath, rustName: `${prefix}presign` },
    size: { ...onPath, rustName: `${prefix}size` },
    stat: { ...onPath, rustName: `${prefix}stat` },
    unlink: { ...onPath, rustName: `${prefix}unlink` },
    write: { ...onPath, rustName: `${prefix}write` },
  }) as const;

export const S3Client = b.class({
  rustPath: "crate::webcore::s3_client::S3Client",
  configurable: false,
  construct: { args: { options: b.any }, capability: "js", throws: true, length: 0 },
  static: members("static_"),
  proto: members(""),
});
