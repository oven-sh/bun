// Ported from Electron's spec/api-dialog-spec.ts (option validation), plus
// end-to-end coverage of showMessageBox (rendered as a real window here).

import { beforeAll, describe, expect, test } from "bun:test";
import { BrowserWindow, dialog } from "../src/index.ts";
import { ensureReady } from "./harness.ts";

beforeAll(async () => {
  await ensureReady();
});

describe("dialog module", () => {
  describe("showOpenDialog", () => {
    test("should throw errors when the options are invalid", async () => {
      expect(() => dialog.showOpenDialog({ properties: false as never })).toThrow(
        /Properties must be an array/,
      );
      expect(() => dialog.showOpenDialog({ title: 300 as never })).toThrow(/Title must be a string/);
      expect(() => dialog.showOpenDialog({ buttonLabel: [] as never })).toThrow(
        /Button label must be a string/,
      );
      expect(() => dialog.showOpenDialog({ defaultPath: {} as never })).toThrow(
        /Default path must be a string/,
      );
      expect(() => dialog.showOpenDialog({ filters: {} as never })).toThrow(/Filters must be an array/);
    });
  });

  describe("showSaveDialog", () => {
    test("should throw errors when the options are invalid", async () => {
      expect(() => dialog.showSaveDialog({ title: 300 as never })).toThrow(/Title must be a string/);
      expect(() => dialog.showSaveDialog({ defaultPath: {} as never })).toThrow(
        /Default path must be a string/,
      );
    });
  });

  describe("showMessageBox", () => {
    test("should throw errors when the options are invalid", async () => {
      expect(() => dialog.showMessageBox(undefined as never)).toThrow(TypeError);
      expect(() => dialog.showMessageBox({ message: false as never })).toThrow(
        /Message must be a string/,
      );
      expect(() => dialog.showMessageBox({ message: "m", type: "bogus" as never })).toThrow(
        /Invalid message box type/,
      );
      expect(() => dialog.showMessageBox({ message: "m", buttons: false as never })).toThrow(
        /Buttons must be an array/,
      );
    });

    test("resolves with the clicked button index", async () => {
      const before = new Set(BrowserWindow.getAllWindows().map((w) => w.id));
      const resultPromise = dialog.showMessageBox({
        message: "Pick one",
        detail: "It matters",
        buttons: ["Yes", "No", "Maybe"],
      });
      // The message box is itself a BrowserWindow; find it and click "No".
      const dialogWin = await waitFor(() => BrowserWindow.getAllWindows().find((w) => !before.has(w.id)));
      await dialogWin!.webContents.executeJavaScript(`document.querySelector('button[data-i="1"]').click()`);
      const result = await resultPromise;
      expect(result.response).toBe(1);
      expect(result.checkboxChecked).toBe(false);
    });

    test("reports checkbox state", async () => {
      const before = new Set(BrowserWindow.getAllWindows().map((w) => w.id));
      const resultPromise = dialog.showMessageBox({
        message: "With a checkbox",
        checkboxLabel: "Remember me",
        buttons: ["OK"],
      });
      const dialogWin = await waitFor(() => BrowserWindow.getAllWindows().find((w) => !before.has(w.id)));
      await dialogWin!.webContents.executeJavaScript(`(() => {
        document.getElementById("cb").checked = true;
        document.querySelector('button[data-i="0"]').click();
      })()`);
      const result = await resultPromise;
      expect(result.response).toBe(0);
      expect(result.checkboxChecked).toBe(true);
    });
  });

  describe("showErrorBox", () => {
    test("throws when title or content is not a string", () => {
      expect(() => dialog.showErrorBox(1 as never, "content")).toThrow(TypeError);
      expect(() => dialog.showErrorBox("title", 2 as never)).toThrow(TypeError);
    });
  });
});

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
