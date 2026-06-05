// Ported from Electron's spec/api-tray-spec.ts and api-notification-spec.ts
// (data-model subsets; OS rendering is not wired up).

import { describe, expect, test } from "bun:test";
import { Menu, Notification, Tray, nativeImage } from "../src/index.ts";

const ONE_BY_ONE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("Tray module", () => {
  test("can be constructed from a NativeImage", () => {
    const tray = new Tray(nativeImage.createFromBuffer(Buffer.from(ONE_BY_ONE, "base64")));
    expect(tray.isDestroyed()).toBe(false);
    tray.destroy();
    expect(tray.isDestroyed()).toBe(true);
  });

  test("setToolTip / getToolTip", () => {
    const tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip("hello");
    expect(tray.getToolTip()).toBe("hello");
    tray.destroy();
  });

  test("setContextMenu stores the menu", () => {
    const tray = new Tray(nativeImage.createEmpty());
    const menu = Menu.buildFromTemplate([{ label: "Quit" }]);
    tray.setContextMenu(menu);
    expect(tray.getContextMenu()).toBe(menu);
    tray.destroy();
  });

  test("emits click events", () => {
    const tray = new Tray(nativeImage.createEmpty());
    let clicked = false;
    tray.on("click", () => (clicked = true));
    tray._click();
    expect(clicked).toBe(true);
    tray.destroy();
  });
});

describe("Notification module", () => {
  test("isSupported returns a boolean", () => {
    expect(typeof Notification.isSupported()).toBe("boolean");
  });

  test("stores constructor options", () => {
    const n = new Notification({ title: "Hi", body: "There", silent: true });
    expect(n.title).toBe("Hi");
    expect(n.body).toBe("There");
    expect(n.silent).toBe(true);
  });

  test("defaults missing options", () => {
    const n = new Notification();
    expect(n.title).toBe("");
    expect(n.body).toBe("");
    expect(n.urgency).toBe("normal");
  });

  test("show() emits a show event", () => {
    const n = new Notification({ title: "x" });
    let shown = false;
    n.on("show", () => (shown = true));
    n.show();
    expect(shown).toBe(true);
  });

  test("close() emits a close event", () => {
    const n = new Notification({ title: "x" });
    let closed = false;
    n.on("close", () => (closed = true));
    n.close();
    expect(closed).toBe(true);
  });
});
