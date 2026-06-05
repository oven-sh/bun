// Notification — Electron-compatible desktop notification data model.
//
// OS notification rendering is not wired up; show()/close() emit the
// corresponding events so app logic and tests behave consistently.

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
    this.emit("show", { type: "show" });
  }

  close(): void {
    this.emit("close", { type: "close" });
  }
}
