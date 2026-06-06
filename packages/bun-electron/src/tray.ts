// Tray — Electron-compatible system tray.
//
// On Linux the tray is a real StatusNotifierItem (SNI) D-Bus service: it owns
// org.kde.StatusNotifierItem-<pid>-<n>, serves the SNI properties (Title,
// IconName, Status, ...), and registers with the StatusNotifierWatcher — the
// same protocol libappindicator and Electron use. Whether a watcher / panel is
// present to draw it is the OS's concern; the service is real. setImage/
// setToolTip/setTitle update the served properties and emit the SNI change
// signals. (Without a session bus, it degrades to a pure data model.)

import { EventEmitter } from "node:events";
import { NativeImage } from "./native-image";
import { DBusConnection, variant } from "./dbus";
import type { Menu } from "./menu";

const SNI_IFACE = "org.kde.StatusNotifierItem";
const SNI_PATH = "/StatusNotifierItem";
const PROPS_IFACE = "org.freedesktop.DBus.Properties";
const WATCHER_NAME = "org.kde.StatusNotifierWatcher";
const WATCHER_PATH = "/StatusNotifierWatcher";

let traySeq = 0;

export class Tray extends EventEmitter {
  private _image: NativeImage;
  private _toolTip = "";
  private _title = "";
  private _iconName = "";
  private _contextMenu: Menu | null = null;
  private _destroyed = false;
  private _bus: DBusConnection | null = null;
  private _serviceName = "";
  /** @internal Resolves once SNI registration with a watcher succeeds. */
  readonly whenRegistered: Promise<boolean>;

  constructor(image: NativeImage | string) {
    super();
    this._image = typeof image === "string" ? NativeImage.createFromPath(image) : image;
    if (typeof image === "string") this._iconName = image;
    this.whenRegistered = this._initSNI();
  }

  private async _initSNI(): Promise<boolean> {
    if (process.platform !== "linux" || !process.env.DBUS_SESSION_BUS_ADDRESS) {
      return false;
    }
    try {
      const bus = new DBusConnection();
      await bus.connect();
      if (this._destroyed) {
        bus.close();
        return false;
      }
      this._bus = bus;
      this._serviceName = `org.kde.StatusNotifierItem-${process.pid}-${++traySeq}`;
      await bus.requestName(this._serviceName);

      // Serve the SNI properties.
      bus.export(SNI_PATH, PROPS_IFACE, "GetAll", () => ({
        signature: "a{sv}",
        body: [this._propEntries()],
      }));
      bus.export(SNI_PATH, PROPS_IFACE, "Get", (msg) => {
        const name = msg.body[1] as string;
        const entry = this._propEntries().find(([k]) => k === name);
        return { signature: "v", body: [entry ? entry[1] : variant("s", "")] };
      });
      // Activate / context-menu requests from the host.
      bus.export(SNI_PATH, SNI_IFACE, "Activate", () => {
        if (!this._destroyed) this.emit("click", { type: "click" });
        return { signature: "", body: [] };
      });

      // Register with the watcher (may not exist; that's fine).
      try {
        await bus.call({
          destination: WATCHER_NAME,
          path: WATCHER_PATH,
          iface: WATCHER_NAME,
          member: "RegisterStatusNotifierItem",
          signature: "s",
          body: [this._serviceName],
        });
        return true;
      } catch {
        return false; // no watcher running
      }
    } catch {
      return false; // no usable session bus
    }
  }

  private _propEntries(): Array<[string, { signature: string; value: unknown }]> {
    return [
      ["Category", variant("s", "ApplicationStatus")],
      ["Id", variant("s", "bun-electron")],
      ["Title", variant("s", this._title || this._toolTip || "bun-electron")],
      ["Status", variant("s", "Active")],
      ["IconName", variant("s", this._iconName)],
      ["ToolTip", variant("(sa(iiay)ss)", [this._iconName, [], this._toolTip, ""])],
      ["ItemIsMenu", variant("b", this._contextMenu !== null)],
      ["Menu", variant("o", "/MenuBar")],
    ];
  }

  private _emitSni(member: string): void {
    if (this._bus) {
      try {
        this._bus.emitSignal({ path: SNI_PATH, iface: SNI_IFACE, member });
      } catch {}
    }
  }

  setImage(image: NativeImage | string): void {
    this._image = typeof image === "string" ? NativeImage.createFromPath(image) : image;
    if (typeof image === "string") this._iconName = image;
    this._emitSni("NewIcon");
  }

  getImage(): NativeImage {
    return this._image;
  }

  setToolTip(toolTip: string): void {
    this._toolTip = String(toolTip);
    this._emitSni("NewToolTip");
  }

  getToolTip(): string {
    return this._toolTip;
  }

  setTitle(title: string): void {
    this._title = String(title);
    this._emitSni("NewTitle");
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
    // The host renders the menu from the SNI Menu property; nothing to do here.
  }

  isDestroyed(): boolean {
    return this._destroyed;
  }

  destroy(): void {
    this._destroyed = true;
    this._bus?.close();
    this._bus = null;
    this.removeAllListeners();
  }

  /** @internal The SNI D-Bus service name, once registered. */
  get serviceName(): string {
    return this._serviceName;
  }

  /** @internal Simulate a tray click (no real OS tray host). */
  _click(): void {
    if (!this._destroyed) this.emit("click", { type: "click" });
  }
}
