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
/** `false`: the listener for the message left while the handle was made. */
export const emitHandleIPCMessage = b.fn({
  args: { target: MessageTarget, message: ReceivedMessage, handle: b.any },
  returns: b.bool,
  capability: "js",
  throws: true,
});

/** `process[kHandle]` of a `ChildProcess`. */
const subprocess = Subprocess.otherAsNull;
/** In the channel of a `ChildProcess`, a 'message' waits for a 'message' listener. */
export const gateSubprocessIpc = b.fn({ args: { subprocess } });
/** A `ChildProcess` got a listener while its channel held messages back. */
export const requestSubprocessIpcDrain = b.fn({ args: { subprocess } });
/** The next-tick callback of a drain request. `owner` is not a Subprocess for the channel of this process. */
export const drainIpc = b.fn({ export: "Bun__IPC__drain", args: { owner: subprocess } });

/** `process.send()` */
export const send = b.fn({
  args: { message: b.any, handle: b.any, options: b.any, callback: b.any },
  returns: b.bool,
  capability: "js",
  throws: true,
});
