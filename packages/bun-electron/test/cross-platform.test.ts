// Verifies the macOS / Windows / Linux platform-branching LOGIC deterministically
// from any host. This does NOT run CEF on mac/win (that needs the hardware) —
// it exercises the pure per-OS path/command resolution that is where platform
// bugs actually live: helper subprocess path, mac framework bundle, win DLL
// shim name, CefSettings resources/locales dirs, app.getPath bases, and the
// shell launcher command. These functions take the platform as a parameter,
// so all three branches are checked on Linux CI.

import { describe, expect, test } from "bun:test";
import { resolveLayout, buildInitKV } from "../src/native.ts";
import { resolveAppPath } from "../src/app.ts";
import { openCommandFor } from "../src/shell.ts";

const ROOT = "/pkg";

function kv(platform: NodeJS.Platform, arch = "x64", env: NodeJS.ProcessEnv = {}) {
  const layout = resolveLayout(platform, arch, ROOT);
  return {
    layout,
    pairs: buildInitKV(platform, arch, { switches: [] }, layout, env, 123),
  };
}

describe("platform layout (native)", () => {
  test("linux x64", () => {
    const layout = resolveLayout("linux", "x64", ROOT);
    expect(layout.distDir).toBe("/pkg/dist/linux-x64");
    expect(layout.shimName).toBe("libbun_electron_shim.so");
    expect(layout.helperRelPath).toBe("bun-electron-helper");
    expect(layout.frameworkRelPath).toBeUndefined();
    expect(layout.resourcesDir).toBe("/pkg/dist/linux-x64");
    expect(layout.localesDir).toBe("/pkg/dist/linux-x64/locales");
  });

  test("linux arm64", () => {
    expect(resolveLayout("linux", "arm64", ROOT).distDir).toBe("/pkg/dist/linux-arm64");
  });

  test("macOS arm64", () => {
    const layout = resolveLayout("darwin", "arm64", ROOT);
    expect(layout.distDir).toBe("/pkg/dist/macos-arm64");
    expect(layout.shimName).toBe("libbun_electron_shim.dylib");
    expect(layout.helperRelPath).toBe(
      "bun-electron Helper.app/Contents/MacOS/bun-electron Helper",
    );
    expect(layout.frameworkRelPath).toBe("Chromium Embedded Framework.framework");
    // mac reads resources/locales from the framework bundle, not dist dirs.
    expect(layout.resourcesDir).toBeUndefined();
    expect(layout.localesDir).toBeUndefined();
  });

  test("macOS x64", () => {
    expect(resolveLayout("darwin", "x64", ROOT).distDir).toBe("/pkg/dist/macos-x64");
  });

  test("windows x64", () => {
    const layout = resolveLayout("win32", "x64", ROOT);
    expect(layout.distDir).toBe("/pkg/dist/windows-x64");
    expect(layout.shimName).toBe("bun_electron_shim.dll");
    expect(layout.helperRelPath).toBe("bun-electron-helper.exe");
    expect(layout.frameworkRelPath).toBeUndefined();
    expect(layout.resourcesDir).toBe("/pkg/dist/windows-x64");
    expect(layout.localesDir).toBe("/pkg/dist/windows-x64/locales");
  });
});

describe("buildInitKV per platform", () => {
  test("macOS sets framework_dir and omits resources/locales", () => {
    const { pairs } = kv("darwin", "arm64", { HOME: "/Users/x", TMPDIR: "/tmp" });
    expect(pairs.framework_dir).toBe(
      "/pkg/dist/macos-arm64/Chromium Embedded Framework.framework",
    );
    expect(pairs.resources_dir).toBeUndefined();
    expect(pairs.locales_dir).toBeUndefined();
    expect(pairs.subprocess_path).toBe(
      "/pkg/dist/macos-arm64/bun-electron Helper.app/Contents/MacOS/bun-electron Helper",
    );
  });

  test("windows sets resources/locales and .exe helper, no framework", () => {
    const { pairs } = kv("win32", "x64", { TEMP: "C:\\Temp" });
    expect(pairs.framework_dir).toBeUndefined();
    expect(pairs.resources_dir).toBe("/pkg/dist/windows-x64");
    expect(pairs.locales_dir).toBe("/pkg/dist/windows-x64/locales");
    expect(pairs.subprocess_path).toBe("/pkg/dist/windows-x64/bun-electron-helper.exe");
    // Windows cache base comes from TEMP.
    expect(pairs.cache_dir).toBe("C:\\Temp/bun-electron-123");
  });

  test("linux sets resources/locales and bare helper", () => {
    const { pairs } = kv("linux", "x64", { TMPDIR: "/tmp" });
    expect(pairs.subprocess_path).toBe("/pkg/dist/linux-x64/bun-electron-helper");
    expect(pairs.resources_dir).toBe("/pkg/dist/linux-x64");
    expect(pairs.cache_dir).toBe("/tmp/bun-electron-123");
  });
});

describe("app.getPath per platform", () => {
  const env = {
    HOME: "/home/u",
    USERPROFILE: "C:\\Users\\u",
    APPDATA: "C:\\Users\\u\\AppData\\Roaming",
    XDG_CONFIG_HOME: "/home/u/.config",
  };

  test("macOS userData", () => {
    expect(resolveAppPath("darwin", "userData", "MyApp", env, "/exe")).toBe(
      "/home/u/Library/Application Support/MyApp",
    );
  });

  test("windows userData", () => {
    expect(resolveAppPath("win32", "userData", "MyApp", env, "/exe")).toBe(
      "C:\\Users\\u\\AppData\\Roaming/MyApp",
    );
  });

  test("linux userData", () => {
    expect(resolveAppPath("linux", "userData", "MyApp", env, "/exe")).toBe(
      "/home/u/.config/MyApp",
    );
  });

  test("exe is the executable path on all platforms", () => {
    for (const p of ["darwin", "win32", "linux"] as const) {
      expect(resolveAppPath(p, "exe", "MyApp", env, "/path/to/bun")).toBe("/path/to/bun");
    }
  });
});

describe("shell.openExternal command per platform", () => {
  test("macOS uses open", () => {
    expect(openCommandFor("darwin", "https://bun.com")).toEqual(["open", "https://bun.com"]);
  });

  test("windows uses rundll32 (not cmd.exe)", () => {
    expect(openCommandFor("win32", "https://bun.com")).toEqual([
      "rundll32",
      "url.dll,FileProtocolHandler",
      "https://bun.com",
    ]);
  });

  test("linux uses xdg-open", () => {
    expect(openCommandFor("linux", "https://bun.com")).toEqual(["xdg-open", "https://bun.com"]);
  });
});
