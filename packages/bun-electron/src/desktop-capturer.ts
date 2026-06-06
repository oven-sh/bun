// desktopCapturer — Electron-compatible source enumeration.
//
// Screen sources are derived from CEF's real display list (via the screen
// module). Window enumeration and live thumbnails require platform capture
// APIs CEF does not expose, so window sources are empty and thumbnails are
// empty NativeImages. getUserMedia with chromeMediaSource still works in the
// renderer for actual capture.

import { screen } from "./screen";
import { NativeImage } from "./native-image";

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
    // "window" sources require an OS window-enumeration API CEF doesn't expose.
    return sources;
  },
};
