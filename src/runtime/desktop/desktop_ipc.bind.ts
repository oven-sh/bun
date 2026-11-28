import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::desktop::ipc::ipc_main" });

export const ipcMain = b.namespace({
  handle: {
    args: { channel: b.string.utf8, listener: b.callable },
    capability: "js",
  },
  removeHandler: {
    args: { channel: b.string.utf8 },
  },
  on: {
    args: { channel: b.string.utf8, listener: b.callable },
    capability: "js",
  },
  removeAllListeners: {
    args: { channel: b.string.utf8.nullable },
  },
  setDispatcher: {
    args: { fn: b.callable },
    capability: "js",
  },
  sendIpcReply: {
    args: { windowId: b.u32, reqId: b.u32, ok: b.bool, json: b.string.utf8 },
  },
  setBinaryDispatcher: {
    args: { fn: b.callable },
    capability: "js",
  },
  sendIpcBinaryReply: {
    args: {
      windowId: b.u32,
      reqId: b.u32,
      status: b.u16,
      data: b.bytes({ from: ["string", "buffer"] }),
    },
  },
});
