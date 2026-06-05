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
