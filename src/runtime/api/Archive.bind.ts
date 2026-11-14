import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

const method = { returns: b.any.returning("Promise"), capability: "js", throws: true } as const;
const settlingWith = (value: table.TableType) => ({
  ...method,
  returns: b.any.returning(table.instance("Promise").holding({ value, reason: table.any }).spec),
});

export const Archive = b.class({
  rustPath: "crate::api::archive::Archive",
  construct: { args: { data: b.any, options: b.any }, capability: "js", throws: true, length: 0 },
  proto: {
    blob: settlingWith(table.instance("Blob")),
    bytes: settlingWith(table.instance("Buffer")),
    extract: { ...method, args: { path: b.any, options: b.any } },
    files: {
      ...settlingWith(table.instance("Map").holding({ key: table.string, value: table.instance("Blob") })),
      args: { glob: b.any },
      length: 0,
    },
  },
  static: {
    write: { ...method, args: { path: b.any, data: b.any, options: b.any }, length: 2 },
  },
});
