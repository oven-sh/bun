// Ported from Electron's spec/api-web-contents-spec.ts
// (executeJavaScript + navigation subset).

import { beforeAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createWindow, dataURL, ensureReady } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

describe("webContents module", () => {
  describe("webContents.executeJavaScript", () => {
    const expected = "hello, world!";

    test("resolves the returned promise with the result", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      const result = await w.webContents.executeJavaScript(`'${expected}'`);
      expect(result).toBe(expected);
    });

    test("resolves the returned promise with the result if the code returns an asynchronous promise", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      const result = await w.webContents.executeJavaScript(
        `new Promise((resolve) => setTimeout(() => resolve('${expected}'), 20))`,
      );
      expect(result).toBe(expected);
    });

    test("rejects the returned promise if an async error is thrown", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      await expect(w.webContents.executeJavaScript(`Promise.reject(new Error('boom'))`)).rejects.toThrow("boom");
    });

    test("rejects the returned promise if the code throws synchronously", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      await expect(w.webContents.executeJavaScript(`throw new Error('sync boom')`)).rejects.toThrow("sync boom");
    });

    test("can return objects and arrays", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      const result = await w.webContents.executeJavaScript(`({ list: [1, 2, 3], ok: true, s: "str" })`);
      expect(result).toEqual({ list: [1, 2, 3], ok: true, s: "str" });
    });

    test("can use the DOM", async () => {
      const w = createWindow();
      await w.loadURL(dataURL(`<body><div id="x">from-dom</div></body>`));
      const result = await w.webContents.executeJavaScript(`document.getElementById("x").textContent`);
      expect(result).toBe("from-dom");
    });
  });

  describe("webContents.getTitle / getURL", () => {
    test("returns the page title and url after load", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<title>wc-title</title><body></body>"));
      expect(w.webContents.getTitle()).toBe("wc-title");
      expect(w.webContents.getURL()).toStartWith("data:text/html");
    });
  });

  describe("webContents.insertCSS(css)", () => {
    test("inserts CSS into the page", async () => {
      const w = createWindow();
      await w.loadURL(dataURL(`<body><div id="t">x</div></body>`));
      await w.webContents.insertCSS("#t { color: rgb(255, 0, 0); }");
      const color = await w.webContents.executeJavaScript(`getComputedStyle(document.getElementById("t")).color`);
      expect(color).toBe("rgb(255, 0, 0)");
    });

    test("removeInsertedCSS removes the inserted CSS", async () => {
      const w = createWindow();
      await w.loadURL(dataURL(`<body><div id="t">x</div></body>`));
      const key = await w.webContents.insertCSS("#t { color: rgb(0, 128, 0); }");
      await w.webContents.removeInsertedCSS(key);
      const color = await w.webContents.executeJavaScript(`getComputedStyle(document.getElementById("t")).color`);
      expect(color).toBe("rgb(0, 0, 0)");
    });
  });

  describe("webContents.isLoading()", () => {
    test("returns false once the page has finished loading", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      expect(w.webContents.isLoading()).toBe(false);
    });
  });


  describe("webContents.printToPDF()", () => {
    test("resolves with a PDF Buffer", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body><h1>print me</h1></body>"));
      const pdf = await w.webContents.printToPDF({});
      expect(Buffer.isBuffer(pdf)).toBe(true);
      // PDFs start with "%PDF-".
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });
  });

  describe("webContents.setUserAgent()/getUserAgent()", () => {
    test("overrides the user agent seen by the page", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      await w.webContents.setUserAgent("BunElectron/1.0 test-agent");
      expect(w.webContents.getUserAgent()).toBe("BunElectron/1.0 test-agent");
      await w.loadURL(dataURL("<body>reloaded</body>"));
      const ua = await w.webContents.executeJavaScript("navigator.userAgent");
      expect(ua).toBe("BunElectron/1.0 test-agent");
    });
  });

  describe("webContents zoom", () => {
    test("setZoomFactor / getZoomFactor round-trip", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      w.webContents.setZoomFactor(1.5);
      expect(w.webContents.getZoomFactor()).toBeCloseTo(1.5, 5);
    });

    test("setZoomLevel / getZoomLevel round-trip", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      w.webContents.setZoomLevel(2);
      expect(w.webContents.getZoomLevel()).toBe(2);
    });

    test("setZoomFactor rejects non-positive factors", () => {
      const w = createWindow();
      expect(() => w.webContents.setZoomFactor(0)).toThrow(TypeError);
    });
  });

  describe("webContents audio", () => {
    test("setAudioMuted / isAudioMuted round-trip", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body></body>"));
      expect(w.webContents.isAudioMuted()).toBe(false);
      w.webContents.setAudioMuted(true);
      expect(w.webContents.isAudioMuted()).toBe(true);
    });
  });

  describe("webContents navigation history", () => {
    test("canGoBack becomes true after a second navigation and goBack returns", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<title>first</title><body>1</body>"));
      expect(w.webContents.canGoBack()).toBe(false);
      await w.loadURL(dataURL("<title>second</title><body>2</body>"));
      // Wait for the loading-state event carrying canGoBack to arrive.
      await waitForTrue(() => w.webContents.canGoBack());
      expect(w.webContents.canGoBack()).toBe(true);
      w.webContents.goBack();
      await waitForTrue(async () => {
        try {
          return (await w.webContents.executeJavaScript("document.title")) === "first";
        } catch {
          return false; // transient error mid-navigation
        }
      });
      expect(await w.webContents.executeJavaScript("document.title")).toBe("first");
    });

    test("clearHistory resets canGoBack/canGoForward", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body>a</body>"));
      await w.loadURL(dataURL("<body>b</body>"));
      await waitForTrue(() => w.webContents.canGoBack());
      w.webContents.clearHistory();
      expect(w.webContents.canGoBack()).toBe(false);
      expect(w.webContents.canGoForward()).toBe(false);
    });
  });

  describe("webContents.findInPage", () => {
    test("reports the number of matches", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body>hello hello hello world</body>"));
      const result = await new Promise<{ matches: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no final find result")), 8000);
        w.webContents.on("found-in-page", (_event, r) => {
          if (r.finalUpdate) {
            clearTimeout(timer);
            resolve(r);
          }
        });
        w.webContents.findInPage("hello");
      });
      expect(result.matches).toBe(3);
      w.webContents.stopFindInPage("clearSelection");
    });

    test("returns a request id and rejects empty queries", async () => {
      const w = createWindow();
      await w.loadURL(dataURL("<body>text</body>"));
      const id = w.webContents.findInPage("text");
      expect(typeof id).toBe("number");
      w.webContents.stopFindInPage();
      expect(() => w.webContents.findInPage("")).toThrow(TypeError);
    });
  });

  describe("console-message event", () => {
    test("is emitted for console.log in the page", async () => {
      const w = createWindow();
      const message = once(w.webContents, "console-message");
      w.loadURL(dataURL(`<body><script>console.log("from-the-page")</script></body>`)).catch(() => {});
      const [event] = await message;
      expect(event.message).toBe("from-the-page");
    });
  });
});


async function waitForTrue(cond: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitForTrue timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}
