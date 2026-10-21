import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::shell::interpreter" });

export const ShellInterpreter = b.class({
  rustPath: "crate::shell::Interpreter",
  configurable: false,
  internalFields: ["resolve", "reject", "jsobjs"],
  memoryCost: true,
  estimatedSize: true,
  proto: {
    run: { capability: "js", throws: true, rustName: "run_from_js" },
  },
});

export const createShellInterpreter = b.fn({
  args: { resolve: b.any, reject: b.any, parsedShellScript: b.any },
  returns: ShellInterpreter,
  capability: "js",
  throws: true,
});
