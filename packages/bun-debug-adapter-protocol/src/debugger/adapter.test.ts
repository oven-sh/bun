import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { resolveCommand } from "./adapter.ts";

/**
 * Build an ad-hoc `PATH` with a single directory that contains `files`, where
 * each key is a filename (e.g. `"bun.cmd"`) and the value is its contents.
 */
function makePathDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "resolve-command-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
    try {
      chmodSync(full, 0o755);
    } catch {}
  }
  return dir;
}

describe("resolveCommand", () => {
  test("is a no-op on POSIX", () => {
    // On non-Windows we let `spawn` do its own PATH resolution.
    expect(resolveCommand("bun", { PATH: "/does/not/exist" }, "linux")).toBe("bun");
    expect(resolveCommand("bun", { PATH: "/does/not/exist" }, "darwin")).toBe("bun");
  });

  // NOTE: PATHEXT in these tests is lowercase so the extensions we supply
  // match the files we create on disk regardless of the host filesystem's
  // case-sensitivity. Real Windows NTFS is case-insensitive so `.CMD` in
  // PATHEXT happily matches a `bun.cmd` file; we're only spoofing `win32`
  // here, so we keep casings aligned to avoid a Linux-only false failure.
  test("resolves a bare name to a .cmd file found on PATH (the #29636 scenario)", () => {
    // Mirrors the bug scenario: `bun` installed via npm wrapper on Windows
    // resolves to `bun.cmd`. `spawn("bun", ...)` would fail with EINVAL; the
    // helper hands `spawn` the absolute `.cmd` path instead.
    const dir = makePathDir({ "bun.cmd": "@echo off\r\necho hi\r\n" });
    const result = resolveCommand("bun", { PATH: dir, PATHEXT: ".com;.exe;.bat;.cmd" }, "win32");
    expect(result).toBe(join(dir, "bun.cmd"));
  });

  test("prefers .exe over .cmd when both exist (PATHEXT order)", () => {
    const dir = makePathDir({
      "bun.cmd": "@echo off\r\n",
      "bun.exe": "MZ", // PE magic — contents don't matter for the lookup
    });
    const result = resolveCommand("bun", { PATH: dir, PATHEXT: ".exe;.cmd" }, "win32");
    expect(result).toBe(join(dir, "bun.exe"));
  });

  test("respects PATHEXT ordering when reversed", () => {
    const dir = makePathDir({
      "bun.cmd": "@echo off\r\n",
      "bun.exe": "MZ",
    });
    const result = resolveCommand("bun", { PATH: dir, PATHEXT: ".cmd;.exe" }, "win32");
    expect(result).toBe(join(dir, "bun.cmd"));
  });

  test("returns the original command when not found", () => {
    // When nothing matches we fall through to spawn, letting it produce its
    // usual ENOENT — we don't want to hide "command missing" errors.
    const dir = makePathDir({});
    expect(resolveCommand("bun", { PATH: dir, PATHEXT: ".exe;.cmd" }, "win32")).toBe("bun");
  });

  test("leaves absolute paths untouched", () => {
    // If the caller already gave us an absolute path, PATH lookup is noise.
    const dir = makePathDir({ "bun.cmd": "@echo off\r\n" });
    const abs = join(dir, "bun.cmd");
    expect(resolveCommand(abs, { PATH: dir }, "win32")).toBe(abs);
  });

  test("leaves relative paths containing separators untouched", () => {
    // `spawn` handles these itself relative to `cwd`; we don't want to second-
    // guess which directory the user meant.
    expect(resolveCommand(`.${sep}bun`, { PATH: "" }, "win32")).toBe(`.${sep}bun`);
    expect(resolveCommand("tools/bun", { PATH: "" }, "win32")).toBe("tools/bun");
  });

  test("leaves commands that already have an extension untouched", () => {
    // If the caller explicitly asked for `bun.exe` or `bun.cmd`, we honour it.
    expect(resolveCommand("bun.exe", { PATH: "" }, "win32")).toBe("bun.exe");
    expect(resolveCommand("bun.cmd", { PATH: "" }, "win32")).toBe("bun.cmd");
  });

  test.skipIf(process.platform !== "win32")("falls back to the default PATHEXT when the env omits it", () => {
    // Skipped on Linux because the default PATHEXT is uppercase (`.CMD` etc.)
    // but Linux filesystems are case-sensitive — on real Windows NTFS is
    // case-insensitive so a default PATHEXT with `.CMD` matches `bun.cmd`.
    const dir = makePathDir({ "bun.cmd": "@echo off\r\n" });
    const result = resolveCommand("bun", { PATH: dir }, "win32");
    expect(result).toBe(join(dir, "bun.cmd"));
  });

  test("skips empty PATH entries without throwing", () => {
    const dir = makePathDir({ "bun.cmd": "@echo off\r\n" });
    // Windows PATH commonly contains stray `;;` separators. They should be
    // ignored rather than cause bogus matches in the current directory.
    const result = resolveCommand("bun", { PATH: `;${dir};`, PATHEXT: ".cmd" }, "win32");
    expect(result).toBe(join(dir, "bun.cmd"));
  });

  test("accepts lowercased PATH/Path env keys", () => {
    // Windows env vars are case-insensitive at the OS layer, but JS exposes
    // them as case-sensitive strings. Don't miss `Path` or `path` because we
    // only checked `PATH`.
    const dir = makePathDir({ "bun.exe": "MZ" });
    expect(resolveCommand("bun", { Path: dir, PATHEXT: ".exe" }, "win32")).toBe(join(dir, "bun.exe"));
    expect(resolveCommand("bun", { path: dir, PATHEXT: ".exe" }, "win32")).toBe(join(dir, "bun.exe"));
  });
});
