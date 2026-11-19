import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::memory_pressure" });

export const psiTrigger = b.fn({ returns: b.bufferSource.nullable, capability: "heap", throws: true });
export const psiFilter = b.fn({
  args: { armed: b.string.loose.utf8, polls: b.any.variadic },
  returns: b.any,
  capability: "js",
  throws: true,
});
export const watcherHasOsBackend = b.fn({ returns: b.bool, capability: "heap" });
