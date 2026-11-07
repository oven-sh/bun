import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ipc" });

export const closeSentHandle = b.fn({
  export: "Bun__IPC__closeSentHandle",
  args: { handle: b.object.otherAsNull },
  capability: "js",
  throws: true,
});
