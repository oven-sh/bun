import * as b from "../../codegen/bindgen-lib.ts";

export const GlobScanOptions = b.dictionary("GlobScanOptions", {
  onlyFiles: b.bool.loose.nullable.default(true),
  throwErrorOnBrokenSymlink: b.bool.loose.nullable.default(false),
  followSymlinks: b.bool.loose.nullable.default(false),
  absolute: b.bool.loose.nullable.default(false),
  cwd: b.utf8.nullable,
  dot: b.bool.loose.nullable.default(false),
});

export const GlobScanArgument = b.union("GlobScanArgument", {
  cwd: b.utf8,
  options: GlobScanOptions,
});

export const Glob = b.class("Glob", {
  rustPath: "crate::api::glob::Glob",
  configurable: false,
  construct: {
    args: { pattern: b.utf8 },
  },
  proto: {
    scan: {
      builtin: "globScanCodeGenerator",
      length: 1,
    },
    scanSync: {
      builtin: "globScanSyncCodeGenerator",
      length: 1,
    },
    __scan: {
      fn: "scan",
      privateSymbol: "pull",
      args: { options: GlobScanArgument.nullable },
      returns: b.any,
      capability: "js",
      throws: true,
      length: 1,
    },
    __scanSync: {
      fn: "scan_sync",
      privateSymbol: "resolveSync",
      args: { options: GlobScanArgument.nullable },
      returns: b.any,
      capability: "heap",
      throws: true,
      length: 1,
    },
    match: {
      args: { str: b.utf8 },
      returns: b.bool,
    },
  },
});
