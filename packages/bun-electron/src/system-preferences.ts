// systemPreferences — Electron-compatible subset.
//
// Real values for several of these come from OS-specific APIs (Keychain,
// registry, AppKit) that CEF doesn't surface; those return sensible defaults.
// getMediaAccessStatus and the animation settings are commonly used and
// behave consistently here.

import { nativeTheme } from "./native-theme";

type MediaType = "microphone" | "camera" | "screen";

export const systemPreferences = {
  getMediaAccessStatus(mediaType: MediaType): "not-determined" | "granted" | "denied" | "restricted" | "unknown" {
    if (!["microphone", "camera", "screen"].includes(mediaType)) {
      throw new TypeError("Invalid media type");
    }
    // Headless: no OS permission system; report granted (CEF allows by default).
    return "granted";
  },

  getAnimationSettings(): {
    shouldRenderRichAnimation: boolean;
    scrollAnimationsEnabledBySystem: boolean;
    prefersReducedMotion: boolean;
  } {
    return {
      shouldRenderRichAnimation: true,
      scrollAnimationsEnabledBySystem: true,
      prefersReducedMotion: false,
    };
  },

  getAccentColor(): string {
    return "0078d7ff"; // RRGGBBAA, a reasonable default accent
  },

  getColor(color: string): string {
    // A small built-in palette; unknown names throw like Electron.
    const palette: Record<string, string> = {
      "window": nativeTheme.shouldUseDarkColors ? "#202020" : "#ffffff",
      "window-text": nativeTheme.shouldUseDarkColors ? "#ffffff" : "#000000",
      "highlight": "#0078d7",
      "highlight-text": "#ffffff",
    };
    const value = palette[color];
    if (value === undefined) throw new Error(`Unknown color: ${color}`);
    return value;
  },

  getUserDefault(_key: string, _type: string): unknown {
    return undefined;
  },

  isDarkMode(): boolean {
    return nativeTheme.shouldUseDarkColors;
  },
};
