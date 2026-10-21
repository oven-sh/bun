import * as b from "../../codegen/bindgen-lib.ts";

export const ParsedShellScript = b.class({
  rustPath: "crate::shell::ParsedShellScript",
  configurable: false,
  internalFields: ["jsobjs"],
  memoryCost: true,
  estimatedSize: true,
  proto: {
    setCwd: { args: { cwd: b.string.loose }, capability: "js", throws: true },
    setEnv: { args: { env: b.any }, capability: "js", throws: true },
    setQuiet: { args: { quiet: b.bool.loose } },
  },
});
