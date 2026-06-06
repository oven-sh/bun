// ipcMain — Electron-compatible main-process IPC endpoint.

import { EventEmitter } from "node:events";
import { windowById, type BrowserWindow, type WebContents } from "./browser-window";
import * as native from "./native";
import { decodeArgs, encodeValue } from "./serialize";

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

  // ipc-sync may arrive without an owning window (the beipc scheme handler can
  // be reached before the window registry is populated); handle it first.
  if (ev.type === "ipc-sync") {
    const resourceId = ev.resourceId as number;
    let payload: { channel?: string; args?: unknown[] } = {};
    try {
      payload = JSON.parse(Buffer.from(String(ev.body ?? ""), "base64").toString("utf8"));
    } catch {}
    const channel = String(payload.channel ?? "");
    const syncArgs = decodeArgs(payload.args);
    let replied = false;
    const reply = (value: unknown) => {
      if (replied) return;
      replied = true;
      const body = Buffer.from(JSON.stringify({ value: encodeValue(value) })).toString("base64");
      native.resourceReply(resourceId, 200, "application/json", body);
    };
    const event = {
      ...(win ? makeEvent(win) : { sender: undefined, senderId: 0, reply: () => {} }),
      set returnValue(value: unknown) {
        reply(value);
      },
    };
    ipcMain.emit(channel, event, ...syncArgs);
    // Electron returns undefined when no listener sets returnValue.
    reply(undefined);
    return;
  }

  // All remaining event types require the owning window.
  if (!win) return;

  const args = decodeArgs(ev.args);

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
          const json = JSON.stringify(encodeValue(result));
          native.ipcReply(win.id, invokeId, json === undefined ? "null" : json, false);
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          native.ipcReply(win.id, invokeId, JSON.stringify({ message }), true);
        },
      );
  }
}
