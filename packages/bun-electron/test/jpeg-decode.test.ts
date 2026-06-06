// Tests the baseline JPEG decoder against real JPEGs produced by Chromium
// (DevTools Page.captureScreenshot with format "jpeg"), which is the only
// JPEG encoder available in this environment. Verifies dimensions, that a
// solid-color page decodes to roughly that color, and that nativeImage
// resize/crop work on JPEG input.

import { beforeAll, describe, expect, test } from "bun:test";
import { nativeImage } from "../src/index.ts";
import { decodeJPEG } from "../src/jpeg.ts";
import { decodePNG } from "../src/png.ts";
import { createWindow, dataURL, ensureReady, type BrowserWindow } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

async function captureJPEG(w: BrowserWindow): Promise<Buffer> {
  const result = (await w.webContents._devtools("Page.captureScreenshot", {
    format: "jpeg",
    quality: 90,
  })) as { data?: string };
  if (!result.data) throw new Error("no screenshot data");
  return Buffer.from(result.data, "base64");
}

describe("baseline JPEG decoder", () => {
  test("rejects non-JPEG input", () => {
    expect(decodeJPEG(Buffer.from([0, 1, 2, 3]))).toBeNull();
    expect(decodeJPEG(Buffer.from("not a jpeg"))).toBeNull();
  });

  test("decodes a Chromium-produced JPEG to the page dimensions", async () => {
    const w = createWindow({ show: true, width: 320, height: 240 });
    await w.loadURL(dataURL(`<body style="margin:0;background:#ffffff"></body>`));
    const jpeg = await captureJPEG(w);
    // Sanity: starts with the JPEG SOI marker.
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    const raw = decodeJPEG(jpeg);
    expect(raw).not.toBeNull();
    expect(raw!.width).toBeGreaterThanOrEqual(300);
    expect(raw!.height).toBeGreaterThanOrEqual(220);
  });

  test("decodes colors correctly (red page -> red pixels)", async () => {
    const w = createWindow({ show: true, width: 200, height: 200 });
    await w.loadURL(dataURL(`<body style="margin:0;background:rgb(255,0,0)"></body>`));
    const raw = decodeJPEG(await captureJPEG(w))!;
    // Sample a center pixel; JPEG is lossy so allow tolerance.
    const cx = Math.floor(raw.width / 2);
    const cy = Math.floor(raw.height / 2);
    const i = (cy * raw.width + cx) * 4;
    expect(raw.data[i]).toBeGreaterThan(200); // R high
    expect(raw.data[i + 1]).toBeLessThan(80); // G low
    expect(raw.data[i + 2]).toBeLessThan(80); // B low
  });

  test("nativeImage.resize works on a JPEG", async () => {
    const w = createWindow({ show: true, width: 240, height: 180 });
    await w.loadURL(dataURL(`<body style="margin:0;background:#3366cc"></body>`));
    const img = nativeImage.createFromBuffer(await captureJPEG(w));
    expect(img.isEmpty()).toBe(false);
    const resized = img.resize({ width: 60, height: 45 });
    // resize re-encodes as PNG; verify via the PNG decoder.
    const raw = decodePNG(resized.toPNG())!;
    expect({ w: raw.width, h: raw.height }).toEqual({ w: 60, h: 45 });
  });

  test("nativeImage.crop works on a JPEG", async () => {
    const w = createWindow({ show: true, width: 240, height: 180 });
    await w.loadURL(dataURL(`<body style="margin:0;background:#33aa33"></body>`));
    const img = nativeImage.createFromBuffer(await captureJPEG(w));
    const cropped = img.crop({ x: 10, y: 10, width: 50, height: 40 });
    expect(cropped.getSize()).toEqual({ width: 50, height: 40 });
  });
});
