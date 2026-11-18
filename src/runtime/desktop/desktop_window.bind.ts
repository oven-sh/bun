import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::desktop::browser_window" });

export const BrowserWindowOptions = b.dictionary(
  {
    id: b.string.utf8.nullable,
    width: b.i32.default(800),
    height: b.i32.default(600),
    x: b.i32.nullable,
    y: b.i32.nullable,
    title: b.string.utf8.default("Bun Desktop"),
    show: b.bool.default(true),
    resizable: b.bool.default(true),
    frame: b.bool.default(true),
    transparent: b.bool.default(false),
    preload: b.string.utf8.nullable,
    preloadCode: b.string.utf8.nullable,
    nodeIntegration: b.bool.default(false),
    contextIsolation: b.bool.default(true),
  },
  { nonObjectAsEmpty: "typeof", reportedAs: "BrowserWindow options" },
);

export const DesktopWindow = b.class({
  rustPath: "crate::desktop::browser_window::DesktopWindow",
  refCounted: true,
  finalize: true,
  internalFields: ["eventHandlers"],
  construct: {
    args: { options: BrowserWindowOptions.default({}) },
    capability: "js",
    throws: true,
  },
  proto: {
    id: { getter: b.u32 },
    loadURL: { args: { url: b.string.utf8 }, capability: "js", throws: true, returns: b.any },
    loadFile: { args: { path: b.string.utf8 }, capability: "js", throws: true, returns: b.any },
    show: {},
    hide: {},
    close: {},
    setTitle: { args: { title: b.string.utf8 } },
    getTitle: { returns: b.string.utf8 },
    setSize: { args: { width: b.i32, height: b.i32 } },
    getSize: { returns: b.array(b.i32) },
    maximize: {},
    unmaximize: {},
    isMaximized: { returns: b.bool },
    minimize: {},
    isMinimized: { returns: b.bool },
    restore: {},
    focus: {},
    center: {},
    setProgressBar: { args: { progress: b.f64 } },
    sendToRenderer: { args: { channel: b.string.utf8, payload: b.string.utf8 }, throws: true },
    evaluateJavaScript: { args: { code: b.string.utf8 }, capability: "js", throws: true, returns: b.any },
  },
});
