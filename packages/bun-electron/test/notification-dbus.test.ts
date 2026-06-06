// Verifies that Notification.show() emits a REAL freedesktop desktop
// notification on the D-Bus session bus (org.freedesktop.Notifications.Notify),
// not just an in-process event. A private session bus is started, dbus-monitor
// eavesdrops, and the Notify call must appear with our title.
//
// Skips cleanly if the D-Bus tooling isn't available.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Notification } from "../src/index.ts";

const haveDbus = Bun.which("dbus-daemon") && Bun.which("dbus-monitor") && Bun.which("gdbus");

let busAddress = "";
let busPid = 0;
let monitor: Bun.Subprocess<"ignore", "pipe", "ignore"> | null = null;
let monitorOut = "";

beforeAll(async () => {
  if (!haveDbus) return;
  // Start a private session bus (capture address + pid for teardown).
  const daemon = Bun.spawnSync({
    cmd: ["dbus-daemon", "--session", "--print-address=1", "--print-pid=1", "--fork"],
  });
  const lines = daemon.stdout.toString().trim().split("\n");
  busAddress = lines[0].trim();
  busPid = Number(lines[1]?.trim());
  process.env.DBUS_SESSION_BUS_ADDRESS = busAddress;
  // Eavesdrop on Notifications traffic.
  // Eavesdrop all traffic (an interface match-rule does not reliably match
  // method calls to an unowned destination in monitor mode).
  monitor = Bun.spawn({
    cmd: ["dbus-monitor", "--address", busAddress],
    stdout: "pipe",
    stderr: "ignore",
  });
  (async () => {
    const reader = monitor!.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        monitorOut += decoder.decode(value);
      }
    } catch {}
  })();
  await new Promise((r) => setTimeout(r, 400));
});

afterAll(() => {
  monitor?.kill();
  if (busPid) {
    try {
      process.kill(busPid);
    } catch {}
  }
  delete process.env.DBUS_SESSION_BUS_ADDRESS;
});

describe("Notification D-Bus delivery", () => {
  test.skipIf(!haveDbus)("show() emits a Notify call on the session bus", async () => {
    const unique = `be-notify-${Date.now()}`;
    const n = new Notification({ title: unique, body: "hello from bun-electron" });
    let showEmitted = false;
    n.on("show", () => (showEmitted = true));
    n.show();
    expect(showEmitted).toBe(true);

    // Wait for the Notify method call to show up on the monitored bus.
    const start = Date.now();
    while (!monitorOut.includes(unique) && Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(monitorOut).toContain(unique);
    expect(monitorOut).toContain("org.freedesktop.Notifications");
    expect(monitorOut).toContain("Notify");
  }, 15000);

  test.skipIf(!haveDbus)("body text is included in the D-Bus call", async () => {
    const uniqueBody = `be-body-${Date.now()}`;
    const n = new Notification({ title: "title-x", body: uniqueBody });
    n.show();
    const start = Date.now();
    while (!monitorOut.includes(uniqueBody) && Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(monitorOut).toContain(uniqueBody);
  }, 15000);

  test("isSupported returns a boolean regardless of environment", () => {
    expect(typeof Notification.isSupported()).toBe("boolean");
  });
});
