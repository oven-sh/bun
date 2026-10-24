import * as b from "../codegen/bindgen-lib.ts";
import { IpcMessage, IpcSendHandle, IpcSendOptions, Subprocess } from "./api/bun/subprocess.bind.ts";

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
  ignored: b.ignored,
});

export const ReceivedObject = b.dictionary({ cmd: b.string.allowStringObject.otherAsNull }, { deferred: true });
/** What the other process sent. A message without a value is `undefined`. */
export const ReceivedMessage = b.union({
  string: b.jsString,
  bigint: b.bigInt,
  object: ReceivedObject,
  number: b.f64,
  boolean: b.bool,
  null: b.null,
  undefined: b.ignored,
});
/** `handle` is what `parseHandle` of `builtins/Ipc.ts` made of the descriptor. */
export const emitHandleIPCMessage = b.fn({
  args: { target: MessageTarget, message: ReceivedMessage, handle: b.object },
  capability: "js",
  throws: true,
});

/** `process.send()` */
export const send = b.fn({
  args: { message: IpcMessage, handle: IpcSendHandle, options: IpcSendOptions, callback: b.callable.otherAsNull },
  length: 4,
  returns: b.bool,
  capability: "js",
  throws: true,
});
