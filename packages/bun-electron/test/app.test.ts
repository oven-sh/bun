// Ported from Electron's spec/api-app-spec.ts (lifecycle subset).
// Lifecycle tests spawn a fresh bun process per scenario, since quitting
// tears down the process's only CEF instance.

import { beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { app, ensureReady } from "./harness.ts";

const fixtures = path.join(import.meta.dir, "fixtures");

async function runFixture(name: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, path.join(fixtures, name)],
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 60_000);
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  clearTimeout(timer);
  return { stdout: stdout.trim(), exitCode };
}

beforeAll(async () => {
  await ensureReady();
});

describe("app module", () => {
  test("app.whenReady() resolves and isReady() becomes true", () => {
    expect(app.isReady()).toBe(true);
  });

  test("app.getName() / setName()", () => {
    const original = app.getName();
    app.setName("test-name");
    expect(app.getName()).toBe("test-name");
    app.setName(original);
  });

  test("app.getPath() returns sensible paths", () => {
    expect(app.getPath("home").length).toBeGreaterThan(0);
    expect(app.getPath("temp").length).toBeGreaterThan(0);
    expect(app.getPath("exe").length).toBeGreaterThan(0);
    expect(() => app.getPath("bogus")).toThrow();
  });

  test("app.getRuntimeVersion() reports the CEF version", () => {
    expect(app.getRuntimeVersion()).toContain("cef");
  });

  test("app.getAppPath() returns the directory of the main script", () => {
    expect(app.getAppPath().length).toBeGreaterThan(0);
  });

  test("app.getLocale() returns a locale string", () => {
    expect(app.getLocale()).toMatch(/^[a-zA-Z]{1,3}(-[a-zA-Z0-9]+)*$/);
  });

  // Ported from api-app-spec.ts "should emit browser-window-created event..."
  test("emits browser-window-created when a window is created", async () => {
    const { createWindow } = await import("./harness.ts");
    const created = new Promise<unknown>((resolve) => {
      app.once("browser-window-created", (event, window) => resolve(window));
    });
    const w = createWindow();
    expect(await created).toBe(w);
  });

  describe("app lifecycle", () => {
    test("quits when all windows are closed (no window-all-closed listener)", async () => {
      const { stdout, exitCode } = await runFixture("quit-on-window-all-closed.js");
      expect(stdout.split("\n")).toEqual(["window-loaded", "before-quit", "will-quit", "quit"]);
      expect(exitCode).toBe(0);
    });

    test("does not auto-quit when window-all-closed is handled", async () => {
      const { stdout, exitCode } = await runFixture("window-all-closed-listener.js");
      expect(stdout.split("\n")).toContain("window-all-closed");
      expect(exitCode).toBe(0);
    });

    test("app.quit() emits lifecycle events in order", async () => {
      const { stdout, exitCode } = await runFixture("app-quit.js");
      expect(stdout.split("\n")).toEqual(["ready", "before-quit,will-quit,quit"]);
      expect(exitCode).toBe(0);
    });
  });
});
