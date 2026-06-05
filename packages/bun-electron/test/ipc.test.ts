// Ported from Electron's spec/api-ipc-main-spec.ts and spec/api-ipc-spec.ts
// (invoke/handle subset). Renderer-side calls run via executeJavaScript.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ipcMain } from "../src/index.ts";
import { createWindow, dataURL, ensureReady, waitForJS, type BrowserWindow } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

afterEach(() => {
  ipcMain.removeAllListeners();
  for (const channel of ["test-invoke", "once-invoke", "no-handler", "rejects"]) {
    ipcMain.removeHandler(channel);
  }
});

async function loadedWindow(): Promise<BrowserWindow> {
  const w = createWindow();
  await w.loadURL(dataURL("<title>ipc</title><body></body>"));
  return w;
}

describe("ipc main", () => {
  describe("ipcMain.on", () => {
    test("should receive a message sent by ipcRenderer.send()", async () => {
      const w = await loadedWindow();
      const received = new Promise<unknown[]>(resolve => {
        ipcMain.once("message", (event, ...args) => resolve(args));
      });
      await w.webContents.executeJavaScript(
        `ipcRenderer.send("message", "string", 42, true, { nested: [1, 2] }, null)`,
      );
      expect(await received).toEqual(["string", 42, true, { nested: [1, 2] }, null]);
    });

    test("event.sender corresponds to the window's webContents", async () => {
      const w = await loadedWindow();
      const senderId = new Promise<number>(resolve => {
        ipcMain.once("from", event => resolve(event.senderId));
      });
      await w.webContents.executeJavaScript(`ipcRenderer.send("from")`);
      expect(await senderId).toBe(w.id);
    });

    test("event.reply() sends a message back to the renderer", async () => {
      const w = await loadedWindow();
      ipcMain.once("call-me-back", (event, value) => {
        event.reply("reply-channel", value * 2);
      });
      await w.webContents.executeJavaScript(`new Promise((resolve) => {
        ipcRenderer.on("reply-channel", (event, value) => { window.__replied = value; resolve(); });
        ipcRenderer.send("call-me-back", 21);
      })`);
      expect(await waitForJS(w, "window.__replied")).toBe(42);
    });
  });

  describe("ipcRenderer.invoke / ipcMain.handle", () => {
    test("receives the response from the handler", async () => {
      const w = await loadedWindow();
      ipcMain.handle("test-invoke", (event, a, b) => a + b);
      const result = await w.webContents.executeJavaScript(`ipcRenderer.invoke("test-invoke", 2, 40)`);
      expect(result).toBe(42);
    });

    test("resolves with the result of an async handler", async () => {
      const w = await loadedWindow();
      ipcMain.handle("test-invoke", async (event, x) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { doubled: x * 2 };
      });
      const result = await w.webContents.executeJavaScript(`ipcRenderer.invoke("test-invoke", 21)`);
      expect(result).toEqual({ doubled: 42 });
    });

    test("rejects when the handler throws", async () => {
      const w = await loadedWindow();
      ipcMain.handle("rejects", () => {
        throw new Error("oh no");
      });
      const message = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("rejects").then(() => "resolved", (err) => err.message)`,
      );
      expect(message).toContain("oh no");
    });

    test("rejects when there is no handler registered", async () => {
      const w = await loadedWindow();
      const message = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("no-handler").then(() => "resolved", (err) => err.message)`,
      );
      expect(message).toContain("No handler registered");
    });

    test("ipcMain.handleOnce only handles a single invocation", async () => {
      const w = await loadedWindow();
      ipcMain.handleOnce("once-invoke", () => "first");
      const first = await w.webContents.executeJavaScript(`ipcRenderer.invoke("once-invoke")`);
      expect(first).toBe("first");
      const second = await w.webContents.executeJavaScript(
        `ipcRenderer.invoke("once-invoke").then(() => "resolved", (err) => err.message)`,
      );
      expect(second).toContain("No handler registered");
    });

    test("throws when registering a second handler for the same channel", () => {
      ipcMain.handle("test-invoke", () => {});
      expect(() => ipcMain.handle("test-invoke", () => {})).toThrow(/second handler/);
    });
  });

  describe("ipcRenderer", () => {
    test("ipcRenderer.once only fires the listener once", async () => {
      const w = await loadedWindow();
      await w.webContents.executeJavaScript(`(() => {
        window.__count = 0;
        ipcRenderer.once("only-once", () => { window.__count++; });
      })()`);
      w.webContents.send("only-once");
      w.webContents.send("only-once");
      await waitForJS(w, "window.__count >= 1");
      // Deliver one more round-trip to be sure the second send was processed.
      await w.webContents.executeJavaScript("void 0");
      expect(await w.webContents.executeJavaScript("window.__count")).toBe(1);
    });

    test("ipcRenderer.removeListener stops delivery", async () => {
      const w = await loadedWindow();
      await w.webContents.executeJavaScript(`(() => {
        window.__seen = 0;
        const fn = () => { window.__seen++; };
        ipcRenderer.on("gone", fn);
        ipcRenderer.removeListener("gone", fn);
        ipcRenderer.on("marker", () => { window.__marker = true; });
      })()`);
      w.webContents.send("gone");
      w.webContents.send("marker");
      await waitForJS(w, "window.__marker");
      expect(await w.webContents.executeJavaScript("window.__seen")).toBe(0);
    });
  });

  describe("ipcRenderer.sendSync", () => {
    test("returns the value set on event.returnValue", async () => {
      const w = await loadedWindow();
      ipcMain.on("sync-get", (event, key) => {
        (event as { returnValue?: unknown }).returnValue = { got: key, n: 42 };
      });
      const result = await w.webContents.executeJavaScript(
        `ipcRenderer.sendSync("sync-get", "config")`,
      );
      ipcMain.removeAllListeners("sync-get");
      expect(result).toEqual({ got: "config", n: 42 });
    });

    test("returns undefined when no listener sets returnValue", async () => {
      const w = await loadedWindow();
      const result = await w.webContents.executeJavaScript(
        `typeof ipcRenderer.sendSync("sync-nobody")`,
      );
      expect(result).toBe("undefined");
    });
  });

  describe("structured-clone argument types", () => {
    test("Dates, Maps, Sets, and typed arrays survive renderer -> main", async () => {
      const w = await loadedWindow();
      const received = new Promise<unknown[]>((resolve) => {
        ipcMain.once("typed", (event, ...args) => resolve(args));
      });
      await w.webContents.executeJavaScript(`ipcRenderer.send("typed",
        new Date(1700000000000),
        new Map([["k", 1]]),
        new Set([1, 2]),
        new Uint8Array([1, 2, 3]),
        /ab+c/gi,
        undefined,
        NaN,
      )`);
      const [date, map, set, bytes, regexp, undef, nan] = await received;
      expect(date).toBeInstanceOf(Date);
      expect((date as Date).getTime()).toBe(1700000000000);
      expect(map).toBeInstanceOf(Map);
      expect((map as Map<string, number>).get("k")).toBe(1);
      expect(set).toBeInstanceOf(Set);
      expect((set as Set<number>).has(2)).toBe(true);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect([...(bytes as Uint8Array)]).toEqual([1, 2, 3]);
      expect(regexp).toBeInstanceOf(RegExp);
      expect((regexp as RegExp).source).toBe("ab+c");
      expect(undef).toBeUndefined();
      expect(Number.isNaN(nan)).toBe(true);
    });

    test("invoke results round-trip rich types main -> renderer", async () => {
      const w = await loadedWindow();
      ipcMain.handle("rich", () => ({
        when: new Date(1700000000000),
        tags: new Set(["a"]),
        bytes: new Uint8Array([9, 8]),
      }));
      const checks = await w.webContents.executeJavaScript(`(async () => {
        const r = await ipcRenderer.invoke("rich");
        return [
          r.when instanceof Date && r.when.getTime() === 1700000000000,
          r.tags instanceof Set && r.tags.has("a"),
          r.bytes instanceof Uint8Array && r.bytes[0] === 9,
        ];
      })()`);
      ipcMain.removeHandler("rich");
      expect(checks).toEqual([true, true, true]);
    });

    test("main -> renderer webContents.send carries rich types", async () => {
      const w = await loadedWindow();
      await w.webContents.executeJavaScript(`new Promise((resolve) => {
        ipcRenderer.on("rich-push", (event, date, map) => {
          window.__richOk = date instanceof Date && map instanceof Map && map.get("x") === 7;
          resolve();
        });
        window.__listening = true;
      }).catch(() => {}), void 0`);
      w.webContents.send("rich-push", new Date(0), new Map([["x", 7]]));
      const ok = await waitForJS(w, "window.__richOk === true || window.__richOk === false ? String(window.__richOk) : null");
      expect(ok).toBe("true");
    });
  });

  describe("webContents.send", () => {
    test("delivers messages to ipcRenderer.on listeners", async () => {
      const w = await loadedWindow();
      await w.webContents.executeJavaScript(`ipcRenderer.on("greeting", (event, ...args) => { window.__got = args; })`);
      w.webContents.send("greeting", "hello", { from: "main" });
      const got = await waitForJS(w, "window.__got && JSON.stringify(window.__got)");
      expect(JSON.parse(got as string)).toEqual(["hello", { from: "main" }]);
    });
  });
});
