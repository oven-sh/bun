// Tray — Electron-compatible system tray data model.
//
// OS tray-icon rendering is not wired up (CEF has no tray API); this manages
// the icon/tooltip/menu state and emits "click" via _click for tests.

import { EventEmitter } from "node:events";
import { NativeImage } from "./native-image";
import type { Menu } from "./menu";

export class Tray extends EventEmitter {
  private _image: NativeImage;
  private _toolTip = "";
  private _title = "";
  private _contextMenu: Menu | null = null;
  private _destroyed = false;

  constructor(image: NativeImage | string) {
    super();
    this._image = typeof image === "string" ? NativeImage.createFromPath(image) : image;
  }

  setImage(image: NativeImage | string): void {
    this._image = typeof image === "string" ? NativeImage.createFromPath(image) : image;
  }

  getImage(): NativeImage {
    return this._image;
  }

  setToolTip(toolTip: string): void {
    this._toolTip = String(toolTip);
  }

  getToolTip(): string {
    return this._toolTip;
  }

  setTitle(title: string): void {
    this._title = String(title);
  }

  getTitle(): string {
    return this._title;
  }

  setContextMenu(menu: Menu | null): void {
    this._contextMenu = menu;
  }

  getContextMenu(): Menu | null {
    return this._contextMenu;
  }

  popUpContextMenu(): void {
    // No OS rendering; a no-op like Menu.popup.
  }

  isDestroyed(): boolean {
    return this._destroyed;
  }

  destroy(): void {
    this._destroyed = true;
    this.removeAllListeners();
  }

  /** @internal Simulate a tray click (no real OS tray). */
  _click(): void {
    if (!this._destroyed) this.emit("click", { type: "click" });
  }
}
