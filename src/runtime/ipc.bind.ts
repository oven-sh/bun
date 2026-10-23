import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ipc" });

export const SentHandle = b.union({ object: b.object, ignored: b.any });
export const closeSentHandle = b.fn({
  export: "Bun__IPC__closeSentHandle",
  args: { handle: SentHandle },
  capability: "js",
  throws: true,
});
