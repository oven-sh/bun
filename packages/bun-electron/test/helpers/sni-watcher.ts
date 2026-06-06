// Minimal StatusNotifierWatcher — test infrastructure that stands in for the
// desktop panel. It owns org.kde.StatusNotifierWatcher, accepts
// RegisterStatusNotifierItem, and (like a real panel) calls back to read the
// registered item's properties so tests can confirm the tray serves them.

import { DBusConnection, variant } from "../../src/dbus";

const WATCHER_NAME = "org.kde.StatusNotifierWatcher";
const WATCHER_PATH = "/StatusNotifierWatcher";
const PROPS_IFACE = "org.freedesktop.DBus.Properties";

export class TestSniWatcher {
  private bus = new DBusConnection();
  readonly registered: string[] = [];
  private resolveFirst!: (service: string) => void;
  readonly firstRegistration: Promise<string>;

  constructor() {
    this.firstRegistration = new Promise((r) => (this.resolveFirst = r));
  }

  async start(): Promise<void> {
    await this.bus.connect();
    await this.bus.requestName(WATCHER_NAME);
    this.bus.export(WATCHER_PATH, WATCHER_NAME, "RegisterStatusNotifierItem", (msg) => {
      const service = msg.body[0] as string;
      this.registered.push(service);
      this.resolveFirst(service);
      // Announce it like a real watcher.
      this.bus.emitSignal({
        path: WATCHER_PATH,
        iface: WATCHER_NAME,
        member: "StatusNotifierItemRegistered",
        signature: "s",
        body: [service],
      });
      return { signature: "", body: [] };
    });
    // Watcher's own properties (a host is registered).
    this.bus.export(WATCHER_PATH, PROPS_IFACE, "Get", (msg) => {
      const name = msg.body[1] as string;
      if (name === "IsStatusNotifierHostRegistered") {
        return { signature: "v", body: [variant("b", true)] };
      }
      if (name === "RegisteredStatusNotifierItems") {
        return { signature: "v", body: [variant("as", this.registered)] };
      }
      return { signature: "v", body: [variant("s", "")] };
    });
  }

  /** Reads a property the registered item serves, proving the tray's SNI
   * object is live and queryable (the sender is the item's bus name). */
  async readItemProperty(service: string, prop: string): Promise<unknown> {
    const reply = await this.bus.call({
      destination: service,
      path: "/StatusNotifierItem",
      iface: PROPS_IFACE,
      member: "Get",
      signature: "ss",
      body: ["org.kde.StatusNotifierItem", prop],
    });
    return reply.body[0];
  }

  stop(): void {
    this.bus.close();
  }
}
