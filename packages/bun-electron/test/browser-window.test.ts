// Ported from Electron's spec/api-browser-window-spec.ts (subset).
// Test names follow the originals where the behavior carries over.

import { beforeAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { BrowserWindow, createWindow, dataURL, ensureReady } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

describe("BrowserWindow module", () => {
  describe("BrowserWindow constructor", () => {
    test("creates a window with an id", () => {
      const w = createWindow();
      expect(w.id).toBeGreaterThan(0);
      expect(w.isDestroyed()).toBe(false);
    });

    test("each window gets a unique id", () => {
      const w1 = createWindow();
      const w2 = createWindow();
      expect(w1.id).not.toBe(w2.id);
    });
  });

  describe("BrowserWindow.getAllWindows()", () => {
    test("returns all open windows", () => {
      const before = BrowserWindow.getAllWindows().length;
      const w = createWindow();
      expect(BrowserWindow.getAllWindows().length).toBe(before + 1);
      expect(BrowserWindow.getAllWindows()).toContain(w);
    });
  });

  describe("BrowserWindow.fromId(id)", () => {
    test("returns the window with id", () => {
      const w = createWindow();
      expect(BrowserWindow.fromId(w.id)).toBe(w);
    });

    test("returns null for an unknown id", () => {
      expect(BrowserWindow.fromId(123456)).toBeNull();
    });
  });

  describe("BrowserWindow.loadURL(url)", () => {
    test("resolves when the page finishes loading", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<title>loaded</title><h1>hi</h1>"));
      expect(await w.webContents.executeJavaScript("document.title")).toBe("loaded");
    });

    test("should emit did-finish-load event", async () => {
      const w = createWindow();
      const finished = once(w.webContents, "did-finish-load");
      w.loadURL(dataURL("<body>x</body>")).catch(() => {});
      await finished;
    });

    test("should emit did-fail-load event for unreachable urls", async () => {
      const w = createWindow();
      // Grab a free port, then close the listener so nothing is there.
      const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const port = server.port;
      server.stop(true);
      await expect(w.loadURL(`http://127.0.0.1:${port}/`)).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
    });
  });

  describe("BrowserWindow.loadFile(path)", () => {
    test("loads the given file in the window", async () => {
      const w = createWindow();
      await w.loadFile(new URL("./fixtures/page.html", import.meta.url).pathname);
      expect(await w.webContents.executeJavaScript("document.title")).toBe("fixture-page");
    });
  });

  describe("BrowserWindow.close()", () => {
    test("should emit close and closed events", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body>bye</body>"));
      let closeEmitted = false;
      w.on("close", () => {
        closeEmitted = true;
      });
      const closed = once(w, "closed");
      w.close();
      await closed;
      expect(closeEmitted).toBe(true);
      expect(w.isDestroyed()).toBe(true);
    });
  });

  describe("BrowserWindow.destroy()", () => {
    test("prevents crash and emits closed", async () => {
      const w = createWindow();
      const closed = once(w, "closed");
      w.destroy();
      await closed;
      expect(w.isDestroyed()).toBe(true);
      expect(BrowserWindow.getAllWindows()).not.toContain(w);
    });
  });

  describe("BrowserWindow.show() / hide()", () => {
    test("toggles visibility", async () => {
      const w = createWindow({ show: false });
      // Wait for the native window before poking at it.
      await w.loadURL(dataURL("<body></body>"));
      w.show();
      await waitFor(() => w.isVisible());
      expect(w.isVisible()).toBe(true);
      w.hide();
      await waitFor(() => !w.isVisible());
      expect(w.isVisible()).toBe(false);
    });
  });

  describe("BrowserWindow.setTitle(title) / getTitle()", () => {
    test("sets the window title", async () => {
      const w = createWindow({ title: "before" });
      await w.loadURL(dataURL("<body></body>"));
      w.setTitle("after");
      await waitFor(() => w.getTitle() === "after");
      expect(w.getTitle()).toBe("after");
    });
  });

  describe("BrowserWindow.setSize(width, height)", () => {
    test("sets the window size", async () => {
      const w = createWindow({ show: true, width: 420, height: 320 });
      await w.loadURL(dataURL("<body></body>"));
      w.setSize(520, 410);
      await waitFor(() => w.getSize()[0] >= 510);
      const [width, height] = w.getSize();
      // Window managers may adjust by a few pixels (borders, decorations).
      expect(Math.abs(width - 520)).toBeLessThanOrEqual(12);
      expect(Math.abs(height - 410)).toBeLessThanOrEqual(48);
    });
  });

  describe("BrowserWindow.setPosition(x, y)", () => {
    test("sets the window position", async () => {
      const w = createWindow({ show: true });
      await w.loadURL(dataURL("<body></body>"));
      w.setPosition(123, 104);
      await waitFor(() => w.getPosition()[0] !== 0);
      const [x] = w.getPosition();
      expect(Math.abs(x - 123)).toBeLessThanOrEqual(24);
    });
  });

  describe("BrowserWindow events", () => {
    test("emits resize when the window is resized", async () => {
      const w = createWindow({ show: true, width: 300, height: 200 });
      await w.loadURL(dataURL("<body></body>"));
      const resized = once(w, "resize");
      w.setSize(360, 240);
      await resized;
    });

    test("page-title-updated fires with the document title", async () => {
      const w = createWindow();
      const titled = once(w, "page-title-updated");
      w.loadURL(dataURL("<title>from-page</title><body></body>")).catch(() => {});
      const [, title] = await titled;
      expect(title).toBe("from-page");
    });
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
