// Ported from Electron's spec/api-desktop-capturer-spec.ts (getSources shape).

import { beforeAll, describe, expect, test } from "bun:test";
import { desktopCapturer } from "../src/index.ts";
import { decodePNG } from "../src/png.ts";
import { createWindow, dataURL, ensureReady } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

async function settle(ms = 600) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("desktopCapturer module", () => {
  test("getSources({ types: ['screen'] }) returns screen sources", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    expect(sources.length).toBeGreaterThanOrEqual(1);
    for (const source of sources) {
      expect(typeof source.id).toBe("string");
      expect(source.id).toStartWith("screen:");
      expect(typeof source.name).toBe("string");
      expect(typeof source.display_id).toBe("string");
      expect(source.thumbnail.isEmpty()).toBe(true);
    }
  });

  test("getSources({ types: [] }) returns no sources", async () => {
    const sources = await desktopCapturer.getSources({ types: [] });
    expect(sources).toEqual([]);
  });

  test("throws when options.types is missing", async () => {
    await expect(desktopCapturer.getSources({} as never)).rejects.toThrow(/types must be an array/);
  });

  describe("window sources (X11)", () => {
    test("enumerates an open BrowserWindow and captures a real thumbnail", async () => {
      const w = createWindow({ show: true, width: 300, height: 220 });
      await w.loadURL(dataURL(`<body style="margin:0;background:rgb(255,0,0)"></body>`));
      await settle();
      const sources = await desktopCapturer.getSources({ types: ["window"] });
      const windows = sources.filter((s) => s.id.startsWith("window:"));
      expect(windows.length).toBeGreaterThanOrEqual(1);
      // At least one window has a non-empty thumbnail with real dimensions.
      const withThumb = windows.find((s) => !s.thumbnail.isEmpty());
      expect(withThumb).toBeDefined();
      const size = withThumb!.thumbnail.getSize();
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    });

    test("captured thumbnail pixels reflect the page (red window)", async () => {
      const w = createWindow({ show: true, width: 260, height: 200 });
      await w.loadURL(dataURL(`<body style="margin:0;background:rgb(255,0,0)"></body>`));
      await settle();
      const sources = await desktopCapturer.getSources({ types: ["window"] });
      // Find the window whose thumbnail is mostly red.
      let foundRed = false;
      for (const s of sources) {
        if (s.thumbnail.isEmpty()) continue;
        const raw = decodePNG(s.thumbnail.toPNG());
        if (!raw) continue;
        const cx = Math.floor(raw.width / 2);
        const cy = Math.floor(raw.height / 2);
        const i = (cy * raw.width + cx) * 4;
        if (raw.data[i] > 200 && raw.data[i + 1] < 80 && raw.data[i + 2] < 80) {
          foundRed = true;
          break;
        }
      }
      expect(foundRed).toBe(true);
    });
  });
});
