import * as b from "../codegen/bindgen-lib.ts";
import { Subprocess } from "./api/bun/subprocess.bind.ts";

export default b.module({ rustPath: "crate::ipc_host" });

export const emitProcessErrorEvent = b.fn({
  export: "Bun__IPC__emitProcessErrorEvent",
  args: { error: b.opaque },
  capability: "js",
});

/** Only `null` is this process. */
export const MessageTarget = b.union({
  subprocess: Subprocess,
  missing: b.undefined,
  thisProcess: b.null,
  other: b.ignored,
});
/**
 * `message` is what the other process sent: any value.
 * `handle` is what `parseHandle` of `builtins/Ipc.ts` made of the descriptor.
 */
export const emitHandleIPCMessage = b.fn({
  args: { target: MessageTarget, message: b.opaque, handle: b.object },
  capability: "js",
  throws: true,
});

/** `process.send()` */
export const send = b.fn({
  args: { message: b.opaque, handle: b.opaque, options: b.opaque, callback: b.opaque },
  returns: b.bool,
  capability: "js",
  throws: true,
});
