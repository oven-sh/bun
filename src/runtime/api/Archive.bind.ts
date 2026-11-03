import * as b from "../../codegen/bindgen-lib.ts";

const method = { returns: b.any.returning("Promise"), capability: "js", throws: true } as const;

export const Archive = b.class({
  rustPath: "crate::api::archive::Archive",
  construct: { args: { data: b.any, options: b.any }, capability: "js", throws: true, length: 0 },
  proto: {
    blob: method,
    bytes: method,
    extract: { ...method, args: { path: b.any, options: b.any } },
    files: { ...method, args: { glob: b.any }, length: 0 },
  },
  static: {
    write: { ...method, args: { path: b.any, data: b.any, options: b.any }, length: 2 },
  },
});
