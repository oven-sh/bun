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
export { clipboard } from "./clipboard";
export { safeStorage } from "./safe-storage";
export { globalShortcut } from "./global-shortcut";
export { Tray } from "./tray";
export { Notification } from "./notification";
export type { NotificationConstructorOptions } from "./notification";
export { net, ClientRequest } from "./net";
export { MessageChannelMain, MessagePortMain } from "./message-channel";
export { powerMonitor } from "./power-monitor";
export { desktopCapturer } from "./desktop-capturer";
export { Session } from "./session";

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
import { clipboard } from "./clipboard";
import { safeStorage } from "./safe-storage";
import { globalShortcut } from "./global-shortcut";
import { Tray } from "./tray";
import { Notification } from "./notification";
import { net } from "./net";
import { MessageChannelMain, MessagePortMain } from "./message-channel";
import { powerMonitor } from "./power-monitor";
import { desktopCapturer } from "./desktop-capturer";

export default {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  MenuItem,
  nativeImage,
  MessageChannelMain,
  MessagePortMain,
  desktopCapturer,
  net,
  Notification,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
};
