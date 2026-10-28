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

/** `strings` is an array-like and `templateArgs` an array. They are read in turn, one element of each at a time. */
export const createParsedShellScript = b.fn({
  args: { strings: b.opaque, templateArgs: b.jsArray },
  returns: ParsedShellScript,
  capability: "js",
  throws: true,
});
