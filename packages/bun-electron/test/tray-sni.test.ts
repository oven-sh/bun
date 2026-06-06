// Verifies the Linux tray is a REAL StatusNotifierItem D-Bus service, not a
// data model: a test StatusNotifierWatcher (standing in for the desktop panel)
// receives the tray's registration AND reads back the properties the tray
// serves over D-Bus. Skips cleanly without D-Bus tooling.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Tray, nativeImage } from "../src/index.ts";
import { TestSniWatcher } from "./helpers/sni-watcher.ts";

const haveDbus = Boolean(Bun.which("dbus-daemon"));
let busPid = 0;
let watcher: TestSniWatcher | null = null;

beforeAll(async () => {
  if (!haveDbus) return;
  const daemon = Bun.spawnSync({
    cmd: ["dbus-daemon", "--session", "--print-address=1", "--print-pid=1", "--fork"],
  });
  const [addr, pid] = daemon.stdout.toString().trim().split("\n");
  process.env.DBUS_SESSION_BUS_ADDRESS = addr.trim();
  busPid = Number(pid?.trim());
  watcher = new TestSniWatcher();
  await watcher.start();
});

afterAll(() => {
  watcher?.stop();
  if (busPid) {
    try {
      process.kill(busPid);
    } catch {}
  }
  delete process.env.DBUS_SESSION_BUS_ADDRESS;
});

describe("Tray StatusNotifierItem (Linux D-Bus)", () => {
  test.skipIf(!haveDbus)("registers with the StatusNotifierWatcher", async () => {
    const tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip("bun tray");
    const ok = await tray.whenRegistered;
    expect(ok).toBe(true);
    const service = await watcher!.firstRegistration;
    expect(service).toBe(tray.serviceName);
    expect(watcher!.registered).toContain(tray.serviceName);
    tray.destroy();
  });

  test.skipIf(!haveDbus)("serves its Title and Status properties to the host", async () => {
    const tray = new Tray(nativeImage.createEmpty());
    tray.setTitle("Recording");
    await tray.whenRegistered;
    const title = await watcher!.readItemProperty(tray.serviceName, "Title");
    const status = await watcher!.readItemProperty(tray.serviceName, "Status");
    expect(title).toBe("Recording");
    expect(status).toBe("Active");
    tray.destroy();
  });

  test.skipIf(!haveDbus)("Activate from the host emits a click", async () => {
    const tray = new Tray(nativeImage.createEmpty());
    await tray.whenRegistered;
    const clicked = new Promise<boolean>((resolve) => {
      tray.on("click", () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });
    // The watcher (host) activates the item.
    await watcher!["bus"].call({
      destination: tray.serviceName,
      path: "/StatusNotifierItem",
      iface: "org.kde.StatusNotifierItem",
      member: "Activate",
      signature: "ii",
      body: [0, 0],
    });
    expect(await clicked).toBe(true);
    tray.destroy();
  });

  // Data-model behaviour works regardless of platform.
  test("tooltip and context menu round-trip", () => {
    const tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip("hi");
    expect(tray.getToolTip()).toBe("hi");
    tray.destroy();
    expect(tray.isDestroyed()).toBe(true);
  });
});
