// Ported from Electron's spec/api-global-shortcut-spec.ts (registry subset;
// no real OS key capture, so callbacks are exercised via _trigger).

import { afterEach, describe, expect, test } from "bun:test";
import { globalShortcut } from "../src/index.ts";

afterEach(() => globalShortcut.unregisterAll());

describe("globalShortcut module", () => {
  test("register returns true and isRegistered reflects it", () => {
    expect(globalShortcut.register("CommandOrControl+A", () => {})).toBe(true);
    expect(globalShortcut.isRegistered("CommandOrControl+A")).toBe(true);
  });

  test("registering the same accelerator twice returns false", () => {
    expect(globalShortcut.register("Ctrl+B", () => {})).toBe(true);
    expect(globalShortcut.register("Ctrl+B", () => {})).toBe(false);
  });

  test("accelerators are normalized (order/casing/aliases)", () => {
    globalShortcut.register("Shift+CmdOrCtrl+K", () => {});
    expect(globalShortcut.isRegistered("control+shift+k")).toBe(true);
    expect(globalShortcut.isRegistered("CommandOrControl+Shift+K")).toBe(true);
  });

  test("unregister removes the shortcut", () => {
    globalShortcut.register("Alt+P", () => {});
    globalShortcut.unregister("Alt+P");
    expect(globalShortcut.isRegistered("Alt+P")).toBe(false);
  });

  test("unregisterAll clears all shortcuts", () => {
    globalShortcut.register("Ctrl+1", () => {});
    globalShortcut.register("Ctrl+2", () => {});
    globalShortcut.unregisterAll();
    expect(globalShortcut.isRegistered("Ctrl+1")).toBe(false);
    expect(globalShortcut.isRegistered("Ctrl+2")).toBe(false);
  });

  test("triggering a registered accelerator invokes its callback", () => {
    let fired = 0;
    globalShortcut.register("Ctrl+T", () => fired++);
    expect(globalShortcut._trigger("Ctrl+T")).toBe(true);
    expect(fired).toBe(1);
  });

  test("invalid accelerators throw", () => {
    expect(() => globalShortcut.register("", () => {})).toThrow(TypeError);
    expect(() => globalShortcut.register("Ctrl+A+B", () => {})).toThrow(/multiple keys/);
    expect(() => globalShortcut.register("Ctrl+", () => {})).toThrow(TypeError);
  });
});
