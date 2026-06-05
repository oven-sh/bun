// bun-electron — Electron-compatible desktop apps on Bun + CEF.
//
//   import { app, BrowserWindow, ipcMain } from "bun-electron";
//
//   await app.whenReady();
//   const win = new BrowserWindow({ width: 800, height: 600 });
//   await win.loadURL("https://bun.com");

export { app } from "./app";
export { BrowserWindow, WebContents } from "./browser-window";
export type { BrowserWindowOptions } from "./browser-window";
export { ipcMain } from "./ipc-main";
export type { IpcMainEvent, IpcMainInvokeEvent } from "./ipc-main";
export { shell } from "./shell";

import { app } from "./app";
import { BrowserWindow } from "./browser-window";
import { ipcMain } from "./ipc-main";
import { shell } from "./shell";

export default { app, BrowserWindow, ipcMain, shell };
