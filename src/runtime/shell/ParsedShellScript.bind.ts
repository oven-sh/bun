import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::shell::parsed_shell_script" });

export const ParsedShellScript = b.class({
  rustPath: "crate::shell::ParsedShellScript",
  memoryCost: true,
  estimatedSize: true,
  internalFields: ["jsobjs"],
  proto: {
    setCwd: { args: { cwd: b.string.loose }, capability: "js", throws: true },
    setEnv: { args: { env: b.object }, expected: { env: "env must be an object" }, capability: "js", throws: true },
    setQuiet: { args: { quiet: b.bool.loose } },
  },
});

/** Its `length` and the indices below that are read as they are needed. `other` has no elements. */
export const ShellArrayLike = b.union({
  text: b.string.local,
  bigInt: b.bigInt,
  symbol: b.symbol,
  object: b.object,
  other: b.ignored,
});

/** `strings` and `templateArgs` are read in turn, one element of each at a time. */
export const createParsedShellScript = b.fn({
  args: { strings: ShellArrayLike, templateArgs: b.jsArray },
  returns: ParsedShellScript,
  capability: "js",
  throws: true,
});
