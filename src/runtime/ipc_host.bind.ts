import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ipc_host" });

export const emitProcessErrorEvent = b.fn({
  export: "Bun__IPC__emitProcessErrorEvent",
  args: { error: b.any },
  capability: "js",
});

export const emitHandleIPCMessage = b.fn({
  args: { target: b.any, message: b.any, handle: b.any },
  capability: "js",
  throws: true,
});

/** `process.send()` */
export const send = b.fn({
  args: { message: b.any, handle: b.any, options: b.any, callback: b.any },
  returns: b.bool,
  length: 1,
  capability: "js",
  throws: true,
});
