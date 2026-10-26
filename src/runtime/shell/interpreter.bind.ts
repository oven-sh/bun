import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::shell::interpreter" });

export const ShellInterpreter = b.class({
  rustPath: "crate::shell::Interpreter",
  memoryCost: true,
  estimatedSize: true,
  internalFields: ["resolve", "reject", "jsobjs"],
  proto: {
    cancel: { capability: "js" },
    run: { capability: "js", throws: true, rustName: "run_from_js" },
    /** Returns the stream of the script's stdout. */
    runStreaming: { returns: b.any, capability: "js", throws: true, rustName: "run_streaming_from_js" },
  },
});

export const createShellInterpreter = b.fn({
  args: { resolve: b.any, reject: b.any, parsedShellScript: b.any },
  returns: ShellInterpreter,
  capability: "js",
  throws: true,
});
