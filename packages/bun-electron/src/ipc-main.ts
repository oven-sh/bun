// ipcMain — Electron-compatible main-process IPC endpoint.

import { EventEmitter } from "node:events";
import { windowById, type BrowserWindow, type WebContents } from "./browser-window";
import * as native from "./native";

export interface IpcMainEvent {
  sender: WebContents;
  senderId: number;
  reply: (channel: string, ...args: unknown[]) => void;
  returnValue?: unknown;
}

export interface IpcMainInvokeEvent {
  sender: WebContents;
  senderId: number;
}

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

class IpcMain extends EventEmitter {
  private handlers = new Map<string, { fn: InvokeHandler; once: boolean }>();

  handle(channel: string, handler: InvokeHandler): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`);
    }
    this.handlers.set(channel, { fn: handler, once: false });
  }

  handleOnce(channel: string, handler: InvokeHandler): void {
    if (this.handlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`);
    }
    this.handlers.set(channel, { fn: handler, once: true });
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  _getHandler(channel: string): { fn: InvokeHandler; once: boolean } | undefined {
    return this.handlers.get(channel);
  }
}

export const ipcMain = new IpcMain();

function makeEvent(win: BrowserWindow): IpcMainEvent {
  return {
    sender: win.webContents,
    senderId: win.id,
    reply: (channel: string, ...args: unknown[]) => {
      win.webContents.send(channel, ...args);
    },
  };
}

export function routeIpcEvent(ev: native.NativeEvent): void {
  const win = windowById(ev.windowId as number);
  if (!win) return;

  const args = Array.isArray(ev.args) ? (ev.args as unknown[]) : [];

  if (ev.type === "ipc-message") {
    ipcMain.emit(String(ev.channel), makeEvent(win), ...args);
    return;
  }

  if (ev.type === "ipc-invoke") {
    const invokeId = ev.invokeId as number;
    const channel = String(ev.channel);
    const entry = ipcMain._getHandler(channel);
    if (!entry) {
      native.ipcReply(win.id, invokeId, JSON.stringify({ message: `No handler registered for '${channel}'` }), true);
      return;
    }
    if (entry.once) ipcMain.removeHandler(channel);
    Promise.resolve()
      .then(() => entry.fn(makeEvent(win), ...args))
      .then(
        result => {
          const json = JSON.stringify(result);
          native.ipcReply(win.id, invokeId, json === undefined ? "null" : json, false);
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          native.ipcReply(win.id, invokeId, JSON.stringify({ message }), true);
        },
      );
  }
}
