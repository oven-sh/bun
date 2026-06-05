// Ported from Electron's spec/api-context-bridge-spec.ts /
// "contextIsolation" coverage: verifies the isolation boundary — preload
// globals are invisible to the page, ipcRenderer/contextBridge are not page
// globals, and only exposeInMainWorld values cross over.

import { beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { ipcMain } from "../src/index.ts";
import { createWindow, dataURL, ensureReady } from "./harness.ts";

const isolatedPreload = path.join(import.meta.dir, "fixtures", "preload-isolated.js");

beforeAll(async () => {
  await ensureReady();
});

describe("contextIsolation", () => {
  test("preload globals do not leak into the page", async () => {
    const w = createWindow({ webPreferences: { preload: isolatedPreload, contextIsolation: true } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await w.webContents.executeJavaScript("typeof window.leakedFromPreload")).toBe("undefined");
  });

  test("ipcRenderer and contextBridge are not exposed as page globals", async () => {
    const w = createWindow({ webPreferences: { preload: isolatedPreload, contextIsolation: true } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await w.webContents.executeJavaScript("typeof window.ipcRenderer")).toBe("undefined");
    expect(await w.webContents.executeJavaScript("typeof window.contextBridge")).toBe("undefined");
  });

  test("exposeInMainWorld values are visible to the page", async () => {
    const w = createWindow({ webPreferences: { preload: isolatedPreload, contextIsolation: true } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await w.webContents.executeJavaScript("window.isolatedApi.answer")).toBe(42);
    expect(await w.webContents.executeJavaScript("window.isolatedApi.add(20, 22)")).toBe(42);
    expect(await w.webContents.executeJavaScript('window.isolatedApi.echo("hi")')).toBe("hi");
  });

  test("preload still has access to the DOM (read-through global)", async () => {
    const w = createWindow({ webPreferences: { preload: isolatedPreload, contextIsolation: true } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await w.webContents.executeJavaScript("window.isolatedApi.preloadSawDocument")).toBe(true);
  });

  test("preload still reaches the main process over IPC", async () => {
    const received = new Promise<string>((resolve) => {
      ipcMain.once("isolated-preload-ran", (event, value) => resolve(value as string));
    });
    const w = createWindow({ webPreferences: { preload: isolatedPreload, contextIsolation: true } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await received).toBe("ok");
  });

  test("without contextIsolation, ipcRenderer remains a page global (default)", async () => {
    const w = createWindow({ webPreferences: { preload: isolatedPreload } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await w.webContents.executeJavaScript("typeof window.ipcRenderer")).toBe("object");
  });
});
