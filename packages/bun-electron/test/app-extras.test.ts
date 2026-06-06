// Ported from Electron's spec/api-app-spec.ts: single-instance lock, badge
// count, locales (the parts that run without a second real app instance).

import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { app } from "../src/index.ts";

const fixtures = path.join(import.meta.dir, "fixtures");

afterEach(() => {
  app.releaseSingleInstanceLock();
});

describe("app extras", () => {
  describe("requestSingleInstanceLock", () => {
    test("first caller acquires the lock", () => {
      const lockPath = path.join(tmpdir(), `bun-electron-test-${process.pid}.lock`);
      const prev = process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK;
      process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK = lockPath;
      try {
        expect(app.requestSingleInstanceLock()).toBe(true);
        expect(app.hasSingleInstanceLock()).toBe(true);
        // Idempotent for the holder.
        expect(app.requestSingleInstanceLock()).toBe(true);
      } finally {
        app.releaseSingleInstanceLock();
        rmSync(lockPath, { force: true });
        if (prev === undefined) delete process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK;
        else process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK = prev;
      }
    });

    test("a second process cannot acquire the same lock", async () => {
      const lockPath = path.join(tmpdir(), `bun-electron-test-second-${process.pid}.lock`);
      process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK = lockPath;
      try {
        expect(app.requestSingleInstanceLock()).toBe(true);
        await using proc = Bun.spawn({
          cmd: [process.execPath, path.join(fixtures, "single-instance-second.js")],
          env: { ...process.env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect(exitCode).toBe(0);
        const result = JSON.parse(stdout.trim());
        expect(result.got).toBe(false);
        expect(result.has).toBe(false);
      } finally {
        app.releaseSingleInstanceLock();
        rmSync(lockPath, { force: true });
        delete process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK;
      }
    });

    test("after release, the lock can be re-acquired", () => {
      const lockPath = path.join(tmpdir(), `bun-electron-test-rel-${process.pid}.lock`);
      process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK = lockPath;
      try {
        expect(app.requestSingleInstanceLock()).toBe(true);
        app.releaseSingleInstanceLock();
        expect(app.hasSingleInstanceLock()).toBe(false);
        expect(app.requestSingleInstanceLock()).toBe(true);
      } finally {
        app.releaseSingleInstanceLock();
        rmSync(lockPath, { force: true });
        delete process.env.BUN_ELECTRON_SINGLE_INSTANCE_LOCK;
      }
    });
  });

  describe("badge count", () => {
    test("set and get the badge count", () => {
      expect(app.setBadgeCount(5)).toBe(true);
      expect(app.getBadgeCount()).toBe(5);
      app.setBadgeCount(0);
      expect(app.getBadgeCount()).toBe(0);
    });

    test("rejects negative or non-integer counts", () => {
      expect(() => app.setBadgeCount(-1)).toThrow(TypeError);
      expect(() => app.setBadgeCount(1.5)).toThrow(TypeError);
    });
  });

  describe("locales", () => {
    test("getSystemLocale returns a locale", () => {
      expect(app.getSystemLocale().length).toBeGreaterThan(0);
    });

    test("getPreferredSystemLanguages returns an array", () => {
      const langs = app.getPreferredSystemLanguages();
      expect(Array.isArray(langs)).toBe(true);
      expect(langs.length).toBeGreaterThan(0);
    });
  });
});
