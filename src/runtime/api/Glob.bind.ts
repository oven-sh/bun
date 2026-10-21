import * as b from "../../codegen/bindgen-lib.ts";

export const GlobScanOptions = b.dictionary(
  {
    onlyFiles: b.bool.loose.nullable.default(true),
    throwErrorOnBrokenSymlink: b.bool.loose.nullable.default(false),
    followSymlinks: b.bool.loose.nullable.default(false),
    absolute: b.bool.loose.nullable.default(false),
    cwd: b.string.utf8.nullable,
    dot: b.bool.loose.nullable.default(false),
  },
  { allowArray: true },
);

export const GlobScanArgument = b.union({
  cwd: b.string.utf8,
  options: GlobScanOptions,
});

export const Glob = b.class({
  rustPath: "crate::api::glob::Glob",
  configurable: false,
  construct: {
    args: { pattern: b.string.utf8.owned },
  },
  proto: {
    match: {
      args: { str: b.string.utf8 },
      returns: b.bool,
    },
    scan: {
      builtin: true,
      length: 1,
    },
    scanSync: {
      builtin: true,
      length: 1,
    },
    __scan: {
      privateSymbol: "globScan",
      args: { options: GlobScanArgument.nullable },
      returns: b.any,
      capability: "js",
      throws: true,
    },
    __scanSync: {
      privateSymbol: "globScanSync",
      args: { options: GlobScanArgument.nullable },
      returns: b.any,
      capability: "heap",
      throws: true,
    },
  },
});
