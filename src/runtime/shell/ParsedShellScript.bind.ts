import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::shell::parsed_shell_script" });

export const ParsedShellScript = b.class({
  rustPath: "crate::shell::ParsedShellScript",
  memoryCost: true,
  estimatedSize: true,
  internalFields: ["jsobjs"],
  proto: {
    setCwd: { args: { cwd: b.string.loose }, capability: "js", throws: true },
    setEnv: { args: { env: b.any }, capability: "js", throws: true },
    setQuiet: { args: { quiet: b.bool.loose } },
  },
});

export const createParsedShellScript = b.fn({
  args: { strings: b.any, templateArgs: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
