// Ported from Electron's spec/api-browser-window-spec.ts ("preload" subset)
// and spec/api-context-bridge-spec.ts (exposeInMainWorld subset).

import { beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { ipcMain } from "../src/index.ts";
import { createWindow, dataURL, ensureReady } from "./harness.ts";

const preloadPath = path.join(import.meta.dir, "fixtures", "preload-basic.js");

beforeAll(async () => {
  await ensureReady();
});

describe("BrowserWindow webPreferences.preload", () => {
  test("loads the script before other scripts in window", async () => {
    const w = createWindow({ webPreferences: { preload: preloadPath } });
    await w.loadURL(
      dataURL(
        `<body><script>window.sawPreloadAtParse = window.preloadExecuted === true;</script></body>`,
      ),
    );
    expect(await w.webContents.executeJavaScript("window.sawPreloadAtParse")).toBe(true);
  });

  test("has access to ipcRenderer", async () => {
    const received = new Promise<string>((resolve) => {
      ipcMain.once("preload-ran", (event, value) => resolve(value as string));
    });
    const w = createWindow({ webPreferences: { preload: preloadPath } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await received).toBe("from-preload");
    expect(await w.webContents.executeJavaScript("window.preloadHadIpcRenderer")).toBe(true);
  });

  test("runs in every new document of the window", async () => {
    const w = createWindow({ webPreferences: { preload: preloadPath } });
    await w.loadURL(dataURL("<body>first</body>"));
    expect(await w.webContents.executeJavaScript("window.preloadExecuted")).toBe(true);
    await w.loadURL(dataURL("<body>second</body>"));
    expect(await w.webContents.executeJavaScript("window.preloadExecuted")).toBe(true);
  });
});

describe("contextBridge", () => {
  test("exposeInMainWorld exposes values to the page", async () => {
    const w = createWindow({ webPreferences: { preload: preloadPath } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await w.webContents.executeJavaScript("exposedApi.value")).toBe(42);
  });

  test("exposed functions are callable from the page", async () => {
    const w = createWindow({ webPreferences: { preload: preloadPath } });
    await w.loadURL(dataURL("<body></body>"));
    expect(await w.webContents.executeJavaScript("exposedApi.add(20, 22)")).toBe(42);
  });

  test("exposed properties are not writable", async () => {
    const w = createWindow({ webPreferences: { preload: preloadPath } });
    await w.loadURL(dataURL("<body></body>"));
    const result = await w.webContents.executeJavaScript(
      `(() => { try { exposedApi = "clobbered"; } catch {} return typeof exposedApi; })()`,
    );
    expect(result).toBe("object");
  });
});
