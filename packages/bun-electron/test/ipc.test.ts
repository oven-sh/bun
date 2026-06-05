// Ported from Electron's spec/api-ipc-main-spec.ts and spec/api-ipc-spec.ts
// (invoke/handle subset). Renderer-side calls run via executeJavaScript.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { ipcMain } from "../src/index.ts";
import { createWindow, dataURL, ensureReady, waitForJS, type BrowserWindow } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

afterEach(() => {
  ipcMain.removeAllListeners();
  for (const channel of ["test-invoke", "once-invoke", "no-handler", "rejects"]) {
    ipcMain.removeHandler(channel);
  }
});

async function loadedWindow(): Promise<BrowserWindow> {
  const w = createWindow();
  await w.loadURL(dataURL("<title>ipc</title><body></body>"));
  return w;
}

describe("ipc main", () => {
  describe("ipcMain.on", () => {
    test("should receive a message sent by ipcRenderer.send()", async () => {
      const w = await loadedWindow();
      const received = new Promise<unknown[]>((resolve) => {
        ipcMain.once("message", (event, ...args) => resolve(args));
      });
      await w.webContents.executeJavaScript(
        `ipcRenderer.send("message", "string", 42, true, { nested: [1, 2] }, null)`,
      );
      expect(await received).toEqual(["string", 42, true, { nested: [1, 2] }, null]);
    });

    test("event.sender corresponds to the window's webContents", async () => {
      const w = await loadedWindow();
      const senderId = new Promise<number>((resolve) => {
        ipcMain.once("from", (event) => resolve(event.senderId));
      });
      await w.webContents.executeJavaScript(`ipcRenderer.send("from")`);
      expect(await senderId).toBe(w.id);
    });

    test("event.reply() sends a message back to the renderer", async () => {
      const w = await loadedWindow();
      ipcMain.once("call-me-back", (event, value) => {
        event.reply("reply-channel", value * 2);
      });
      await w.webContents.executeJavaScript(`new Promise((resolve) => {
        ipcRenderer.on("reply-channel", (event, value) => { window.__replied = value; resolve(); });
        ipcRenderer.send("call-me-back", 21);
      })`);
      expect(await waitForJS(w, "window.__replied")).toBe(42);
    });
  });

  describe("ipcRenderer.invoke / ipcMain.handle", () => {
    test("receives the response from the handler", async () => {
      const w = await loadedWindow();
      ipcMain.handle("test-invoke", (event, a, b) => a + b);
      const result = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("test-invoke", 2, 40)`,
      );
      expect(result).toBe(42);
    });

    test("resolves with the result of an async handler", async () => {
      const w = await loadedWindow();
      ipcMain.handle("test-invoke", async (event, x) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { doubled: x * 2 };
      });
      const result = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("test-invoke", 21)`,
      );
      expect(result).toEqual({ doubled: 42 });
    });

    test("rejects when the handler throws", async () => {
      const w = await loadedWindow();
      ipcMain.handle("rejects", () => {
        throw new Error("oh no");
      });
      const message = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("rejects").then(() => "resolved", (err) => err.message)`,
      );
      expect(message).toContain("oh no");
    });

    test("rejects when there is no handler registered", async () => {
      const w = await loadedWindow();
      const message = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("no-handler").then(() => "resolved", (err) => err.message)`,
      );
      expect(message).toContain("No handler registered");
    });

    test("ipcMain.handleOnce only handles a single invocation", async () => {
      const w = await loadedWindow();
      ipcMain.handleOnce("once-invoke", () => "first");
      const first = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("once-invoke")`,
      );
      expect(first).toBe("first");
      const second = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("once-invoke").then(() => "resolved", (err) => err.message)`,
      );
      expect(second).toContain("No handler registered");
    });

    test("throws when registering a second handler for the same channel", () => {
      ipcMain.handle("test-invoke", () => {});
      expect(() => ipcMain.handle("test-invoke", () => {})).toThrow(
        /second handler/,
      );
    });
  });

  describe("webContents.send", () => {
    test("delivers messages to ipcRenderer.on listeners", async () => {
      const w = await loadedWindow();
      await w.webContents.executeJavaScript(
        `ipcRenderer.on("greeting", (event, ...args) => { window.__got = args; })`,
      );
      w.webContents.send("greeting", "hello", { from: "main" });
      const got = await waitForJS(w, "window.__got && JSON.stringify(window.__got)");
      expect(JSON.parse(got as string)).toEqual(["hello", { from: "main" }]);
    });
  });
});
