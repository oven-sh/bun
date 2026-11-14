import * as b from "../codegen/bindgen-lib.ts";
import * as table from "../codegen/builtins/lib.ts";
import { Subprocess } from "./api/bun/subprocess.bind.ts";

export default b.module({ rustPath: "crate::ipc_host" });

export const emitProcessErrorEvent = b.fn({
  export: "Bun__IPC__emitProcessErrorEvent",
  args: { error: b.any },
  capability: "js",
});

export const emitProcessDisconnectEvent = b.fn({ export: "Bun__IPC__emitProcessDisconnectEvent", capability: "js" });

/** Only `null` is this process. */
export const MessageTarget = b.union({
  subprocess: Subprocess,
  missing: b.undefined,
  thisProcess: b.null,
  ignored: b.any,
});
/** What the other process sent: any value. */
export const ReceivedMessage = b.union({ object: b.object, primitive: b.any });
/**
 * Hands the three on to whoever listens: `ipc` of the options of `Bun.spawn`, the listeners of `process`, the callback of node:cluster.
 * It stores nothing on them and calls nothing of theirs. Of a message for this process it reads `cmd`.
 */
export const emitHandleIPCMessage = b.fn({
  args: { target: MessageTarget, message: ReceivedMessage, handle: b.any },
  capability: "js",
  throws: true,
  uses: {
    target: table.retainedByNativeCode,
    message: [...table.retainedByNativeCode, table.runs(table.named("cmd")), table.membersOnlyInspected],
    handle: table.retainedByNativeCode,
  },
});

/** `process.send()` */
export const send = b.fn({
  args: { message: b.any, handle: b.any, options: b.any, callback: b.any },
  returns: b.bool,
  capability: "js",
  throws: true,
});
