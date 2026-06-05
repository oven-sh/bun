// bun-electron — Electron-compatible desktop apps on Bun + CEF.
//
//   import { app, BrowserWindow, ipcMain } from "bun-electron";
//
//   await app.whenReady();
//   const win = new BrowserWindow({ width: 800, height: 600 });
//   await win.loadURL("https://bun.com");

export { app } from "./app";
export { BrowserWindow, NativeImage, WebContents } from "./browser-window";
export type { BrowserWindowOptions } from "./browser-window";
export { ipcMain } from "./ipc-main";
export type { IpcMainEvent, IpcMainInvokeEvent } from "./ipc-main";
export { shell } from "./shell";
export { Menu, MenuItem } from "./menu";
export type { MenuItemConstructorOptions } from "./menu";
export { nativeImage } from "./native-image";
export { dialog } from "./dialog";
export { screen } from "./screen";
export { session } from "./session";
export { protocol } from "./protocol";

import { app } from "./app";
import { BrowserWindow } from "./browser-window";
import { dialog } from "./dialog";
import { ipcMain } from "./ipc-main";
import { Menu, MenuItem } from "./menu";
import { nativeImage } from "./native-image";
import { protocol } from "./protocol";
import { screen } from "./screen";
import { session } from "./session";
import { shell } from "./shell";

export default { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, nativeImage, protocol, screen, session, shell };
