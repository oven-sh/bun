// Shared setup for bun-electron tests.
//
// All test files run in one `bun test` process, sharing a single CEF
// instance. Run under a display server (locally or `xvfb-run -a bun test`).

import { afterEach } from "bun:test";
import { once } from "node:events";
import { app, BrowserWindow, type BrowserWindowOptions } from "../src/index.ts";

if (!process.env.DISPLAY && process.platform === "linux") {
  console.error("bun-electron tests need a display server; run under xvfb-run -a");
}

// Electron spec runners do the same: keep the app alive while windows come
// and go between tests.
app.on("window-all-closed", () => {});

export async function ensureReady(): Promise<void> {
  await app.whenReady();
}

const opened: BrowserWindow[] = [];

export function createWindow(options: BrowserWindowOptions = {}): BrowserWindow {
  const win = new BrowserWindow({ show: false, width: 400, height: 300, ...options });
  opened.push(win);
  return win;
}

export async function closeWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  const closed = once(win, "closed");
  win.destroy();
  await closed;
}

afterEach(async () => {
  for (const win of opened.splice(0)) {
    await closeWindow(win);
  }
});

export function dataURL(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

/** Polls an executeJavaScript expression until it returns a truthy value. */
export async function waitForJS(
  win: BrowserWindow,
  expression: string,
  timeoutMs = 10_000,
): Promise<unknown> {
  const start = Date.now();
  for (;;) {
    const value = await win.webContents.executeJavaScript(expression);
    if (value) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for: ${expression}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export { app, BrowserWindow, once };
