// desktopCapturer — Electron-compatible source enumeration.
//
// Screen sources come from CEF's display list. Window sources come from the
// platform window server: on Linux this enumerates and captures real X11
// top-level windows (the same platform-specific route Electron takes
// internally), producing live PNG thumbnails. getUserMedia with
// chromeMediaSource still works in the renderer for actual streaming capture.

import { screen } from "./screen";
import { NativeImage } from "./native-image";
import { encodePNG, type RawImage } from "./png";
import * as native from "./native";

export interface DesktopCapturerSource {
  id: string;
  name: string;
  display_id: string;
  thumbnail: NativeImage;
}

export interface SourcesOptions {
  types: Array<"screen" | "window">;
  thumbnailSize?: { width: number; height: number };
}

function windowThumbnail(xid: number): NativeImage {
  const captured = native.captureWindow(xid);
  if (!captured || !captured.data) return NativeImage.createEmpty();
  const raw: RawImage = {
    width: captured.width,
    height: captured.height,
    data: Buffer.from(captured.data, "base64"),
  };
  if (raw.width <= 0 || raw.height <= 0) return NativeImage.createEmpty();
  return new NativeImage(encodePNG(raw));
}

export const desktopCapturer = {
  async getSources(options: SourcesOptions): Promise<DesktopCapturerSource[]> {
    if (!options || !Array.isArray(options.types)) {
      throw new TypeError("Invalid options: types must be an array");
    }
    const sources: DesktopCapturerSource[] = [];

    if (options.types.includes("screen")) {
      const displays = screen.getAllDisplays();
      displays.forEach((display, index) => {
        sources.push({
          id: `screen:${index}:0`,
          name: displays.length === 1 ? "Entire Screen" : `Screen ${index + 1}`,
          display_id: String(display.id),
          thumbnail: NativeImage.createEmpty(),
        });
      });
    }

    if (options.types.includes("window")) {
      for (const win of native.enumerateWindows()) {
        sources.push({
          id: `window:${win.xid}:0`,
          name: win.title || `Window ${win.xid}`,
          display_id: "",
          thumbnail: windowThumbnail(win.xid),
        });
      }
    }

    return sources;
  },
};
