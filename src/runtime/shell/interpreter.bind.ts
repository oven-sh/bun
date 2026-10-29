import * as b from "../../codegen/bindgen-lib.ts";
import { ParsedShellScript } from "./ParsedShellScript.bind.ts";

export default b.module({ rustPath: "crate::shell::interpreter" });

export const ShellInterpreter = b.class({
  rustPath: "crate::shell::Interpreter",
  memoryCost: true,
  estimatedSize: true,
  internalFields: ["resolve", "reject", "jsobjs"],
  proto: {
    run: { capability: "js", throws: true, rustName: "run_from_js" },
  },
});

export const createShellInterpreter = b.fn({
  args: { resolve: b.opaque, reject: b.opaque, parsedShellScript: ParsedShellScript.withValue },
  length: 3,
  returns: ShellInterpreter,
  capability: "js",
  throws: true,
});
