// The tables bun:objc reads from the macOS SDK headers: every enumeration's
// members, loose constants, the type encoding of each exported non-object
// constant and of each exported C function. The body is generated at build
// time by scripts/appkit-enums.ts (through scripts/appkit-generate.ts --out)
// from the SDK the build links, and src/codegen/bundle-modules.ts bundles
// that file in place of this one on macOS. This file keeps the module's
// registry slot on every target and names the shape; every other target
// bundles the same throw.
export type EnumTables = {
  /** type name -> [prefix, suffix, value, suffix, value, ...]: a member's full name is prefix + suffix, or the suffix alone after a leading "=". */
  enums: Record<string, (string | number | bigint)[]>;
  /** Members of unnamed enumerations and `static const` numbers. */
  loose: Record<string, number | bigint>;
  /** The type encoding of each exported constant that is not an object; "?" for one the bridge cannot read. */
  constants: Record<string, string>;
  /** The type encoding of each C function (return type, then each argument), with the index of its format argument when it takes `...`. */
  functions: Record<string, string | [string, number]>;
};

export default (() => {
  throw $ERR_OBJC_UNAVAILABLE("bun:objc is only available on macOS");
})() as EnumTables;
