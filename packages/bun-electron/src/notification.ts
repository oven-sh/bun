// Notification — Electron-compatible desktop notification.
//
// On Linux, show() emits a real freedesktop desktop notification over the
// D-Bus session bus (org.freedesktop.Notifications.Notify) via `gdbus` — the
// same interface Electron/Chromium use. Whether a notification daemon is
// running to draw it is the OS's concern (exactly as in Electron); the call
// itself is real and observable on the bus. show()/close() also emit the
// corresponding events for app logic.

import { EventEmitter } from "node:events";

export interface NotificationConstructorOptions {
  title?: string;
  subtitle?: string;
  body?: string;
  silent?: boolean;
  icon?: string;
  hasReply?: boolean;
  timeoutType?: "default" | "never";
  urgency?: "normal" | "critical" | "low";
}

export class Notification extends EventEmitter {
  title: string;
  subtitle: string;
  body: string;
  silent: boolean;
  icon: string;
  hasReply: boolean;
  urgency: "normal" | "critical" | "low";

  constructor(options: NotificationConstructorOptions = {}) {
    super();
    if (options !== null && typeof options !== "object") {
      throw new TypeError("Options must be an object");
    }
    this.title = options.title ?? "";
    this.subtitle = options.subtitle ?? "";
    this.body = options.body ?? "";
    this.silent = options.silent ?? false;
    this.icon = options.icon ?? "";
    this.hasReply = options.hasReply ?? false;
    this.urgency = options.urgency ?? "normal";
  }

  static isSupported(): boolean {
    return true;
  }

  show(): void {
    this.emitNativeNotification();
    this.emit("show", { type: "show" });
  }

  private emitNativeNotification(): void {
    if (process.platform !== "linux") return; // mac/win paths not wired here
    if (!process.env.DBUS_SESSION_BUS_ADDRESS) return; // no session bus
    const gdbus = Bun.which("gdbus");
    if (!gdbus) return;
    const summary = this.title || this.body || "Notification";
    const body = this.title ? this.body : "";
    const timeout = this.urgency === "critical" ? "0" : "5000";
    // gdbus parses each positional as GVariant text, so string parameters are
    // passed as explicitly-quoted/escaped GVariant strings. This both removes
    // parsing ambiguity (a title like "42" or "[x]" would otherwise be read as
    // a number/array) and makes argv flag-smuggling impossible — combined with
    // the "--" option terminator below, no user value can become a gdbus flag.
    const gvar = (s: string) => JSON.stringify(String(s));
    // Only pass an icon that looks like an absolute path or a themed icon name.
    const icon = this.icon && /^(\/|[a-zA-Z0-9][\w.-]*)$/.test(this.icon) ? this.icon : "";
    try {
      Bun.spawn({
        cmd: [
          gdbus, "call", "--session",
          "--dest", "org.freedesktop.Notifications",
          "--object-path", "/org/freedesktop/Notifications",
          "--method", "org.freedesktop.Notifications.Notify",
          "--",
          gvar("bun-electron"), "0", gvar(icon),
          gvar(summary), gvar(body), "[]", "{}", timeout,
        ],
        // Pass env explicitly so a session bus address set at runtime
        // propagates to the child.
        env: { ...process.env },
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      // No daemon / bus issue — the notification simply isn't drawn.
    }
  }

  close(): void {
    this.emit("close", { type: "close" });
  }
}
