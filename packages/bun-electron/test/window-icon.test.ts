// Ported from Electron's spec/api-browser-window-spec.ts ("BrowserWindow.setIcon").

import { beforeAll, describe, expect, test } from "bun:test";
import { nativeImage } from "../src/index.ts";
import { createWindow, dataURL, ensureReady } from "./harness.ts";

const ONE_BY_ONE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeAll(async () => {
  await ensureReady();
});

describe("BrowserWindow.setIcon(icon)", () => {
  test("accepts a NativeImage without throwing", async () => {
    const w = createWindow({ show: true });
    await w.loadURL(dataURL("<body></body>"));
    const icon = nativeImage.createFromBuffer(Buffer.from(ONE_BY_ONE, "base64"));
    expect(() => w.setIcon(icon)).not.toThrow();
  });

  test("throws for an unreadable path", async () => {
    const w = createWindow();
    await w.loadURL(dataURL("<body></body>"));
    expect(() => w.setIcon("/no/such/icon.png")).toThrow(/Failed to load image/);
  });
});
