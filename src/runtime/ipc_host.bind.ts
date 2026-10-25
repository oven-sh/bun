import * as b from "../codegen/bindgen-lib.ts";
import { Subprocess } from "./api/bun/subprocess.bind.ts";

export default b.module({ rustPath: "crate::ipc_host" });

export const emitProcessErrorEvent = b.fn({
  export: "Bun__IPC__emitProcessErrorEvent",
  args: { error: b.any },
  capability: "js",
});

/** Only `null` is this process. */
export const MessageTarget = b.union({
  subprocess: Subprocess,
  missing: b.undefined,
  thisProcess: b.null,
  ignored: b.any,
});
/** What the other process sent: any value. */
export const ReceivedMessage = b.union({ object: b.object, primitive: b.any });
export const emitHandleIPCMessage = b.fn({
  args: { target: MessageTarget, message: ReceivedMessage, handle: b.any },
  capability: "js",
  throws: true,
});

/** `process.send()` */
export const send = b.fn({
  args: { message: b.any, handle: b.any, options: b.any, callback: b.any },
  returns: b.bool,
  capability: "js",
  throws: true,
});
