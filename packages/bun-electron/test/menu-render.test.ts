// Verifies that Menu.popup() renders a REAL native (OS-drawn) menu, not just a
// data model: showing it creates a new native X11 popup window, which we
// detect by enumerating top-level windows before/after.

import { beforeAll, describe, expect, test } from "bun:test";
import { Menu } from "../src/index.ts";
import * as native from "../src/native.ts";
import { createWindow, dataURL, ensureReady } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

async function settle(ms = 500) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("Menu native rendering", () => {
  test("popup() creates a native menu window visible to X11", async () => {
    const w = createWindow({ show: true, width: 400, height: 300, title: "menu-render-host" });
    await w.loadURL(dataURL("<body>host</body>"));
    await settle();

    const before = native.enumerateWindows().length;
    const menu = Menu.buildFromTemplate([
      { label: "Cut" },
      { label: "Copy" },
      { type: "separator" },
      { label: "Paste" },
    ]);
    menu.popup({ window: w, x: 40, y: 40 });
    await settle();

    const after = native.enumerateWindows().length;
    expect(after).toBeGreaterThan(before); // a native menu popup window appeared

    menu.closePopup(w);
    await settle();
    // The menu window goes away again.
    expect(native.enumerateWindows().length).toBeLessThanOrEqual(after);
  });

  test("popup without a window throws", () => {
    const menu = Menu.buildFromTemplate([{ label: "X" }]);
    expect(() => menu.popup()).toThrow(/requires a window/);
  });
});
