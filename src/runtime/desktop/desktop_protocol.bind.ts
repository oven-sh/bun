import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::desktop::protocol::protocol" });

export const protocol = b.namespace({
  handle: {
    args: { scheme: b.string.utf8, handler: b.callable },
    capability: "js",
    throws: true,
  },
  unhandle: {
    args: { scheme: b.string.utf8 },
  },
  isHandled: {
    args: { scheme: b.string.utf8 },
    returns: b.bool,
  },
  registerScheme: {
    args: { scheme: b.string.utf8 },
  },
  setDispatcher: {
    args: { fn: b.callable },
    capability: "js",
  },
  sendResponse: {
    args: {
      windowId: b.u32,
      taskId: b.u32,
      response: b.any,
      rangeHeader: b.string.utf8,
      headersJson: b.string.utf8,
    },
    capability: "js",
    returns: b.bool,
  },
  sendResponseBytes: {
    args: {
      windowId: b.u32,
      taskId: b.u32,
      status: b.u16,
      headersJson: b.string.utf8,
      body: b.bytes({ from: ["string", "buffer"] }),
    },
  },
  sendResponseError: {
    args: {
      windowId: b.u32,
      taskId: b.u32,
      status: b.u16,
    },
  },
});
