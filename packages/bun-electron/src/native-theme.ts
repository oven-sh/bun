// nativeTheme — Electron-compatible theme source.
//
// themeSource drives shouldUseDarkColors and emits "updated". A real OS theme
// signal isn't available headlessly, so "system" resolves via the
// BUN_ELECTRON_THEME env var (or light by default); explicit "dark"/"light"
// always win, matching Electron's precedence.

import { EventEmitter } from "node:events";

type ThemeSource = "system" | "light" | "dark";

class NativeTheme extends EventEmitter {
  private _themeSource: ThemeSource = "system";

  get themeSource(): ThemeSource {
    return this._themeSource;
  }

  set themeSource(value: ThemeSource) {
    if (value !== "system" && value !== "light" && value !== "dark") {
      throw new TypeError("themeSource must be 'system', 'light', or 'dark'");
    }
    const before = this.shouldUseDarkColors;
    this._themeSource = value;
    if (this.shouldUseDarkColors !== before) this.emit("updated");
    else this.emit("updated"); // Electron emits on every set
  }

  get shouldUseDarkColors(): boolean {
    if (this._themeSource === "dark") return true;
    if (this._themeSource === "light") return false;
    return (process.env.BUN_ELECTRON_THEME ?? "").toLowerCase() === "dark";
  }

  get shouldUseHighContrastColors(): boolean {
    return false;
  }

  get shouldUseInvertedColorScheme(): boolean {
    return false;
  }

  get inForcedColorsMode(): boolean {
    return false;
  }
}

export const nativeTheme = new NativeTheme();
