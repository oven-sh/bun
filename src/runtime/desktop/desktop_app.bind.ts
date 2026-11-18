import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::desktop::app::app" });

export const app = b.namespace({
  isReady: { returns: b.bool },
  warm: { capability: "js" },
  quit: { capability: "js" },
  exit: { args: { code: b.i32.default(0) } },
  getName: { returns: b.string.utf8 },
  setName: { args: { name: b.string.utf8 } },
  getVersion: { returns: b.string.utf8 },
  getPath: { args: { name: b.string.utf8 }, returns: b.string.utf8, capability: "heap", throws: true },
  onEvent: {
    args: { event: b.string.utf8, callback: b.callable },
    capability: "js",
  },
  clipboardReadText: { returns: b.string.utf8 },
  clipboardWriteText: { args: { text: b.string.utf8 }, returns: b.bool },
  isDarkMode: { returns: b.bool },
  getPrimaryDisplay: { returns: b.array(b.f64) },
  setMenu: { args: { json: b.string.utf8 } },
  showDialog: { args: { windowId: b.u32, kind: b.u8, optsJson: b.string.utf8 }, capability: "js", returns: b.any },
  powerSaveStart: { args: { kind: b.u8 }, returns: b.u32 },
  powerSaveStop: { args: { id: b.u32 }, returns: b.bool },
  powerSaveIsStarted: { args: { id: b.u32 }, returns: b.bool },
  imageSizeFromPath: { args: { path: b.string.utf8 }, returns: b.array(b.f64) },
  openExternal: { args: { url: b.string.utf8 }, returns: b.bool },
  showItemInFolder: { args: { path: b.string.utf8 }, returns: b.bool },
  trashItem: { args: { path: b.string.utf8 }, returns: b.bool },
  showNotification: { args: { title: b.string.utf8, body: b.string.utf8 }, returns: b.bool },
});
