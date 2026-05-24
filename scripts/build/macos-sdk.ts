/**
 * macOS SDK resolution for cross-compiling darwin targets from a non-darwin
 * host (Linux CI boxes, contributor Linux machines).
 *
 * Native darwin builds never touch this file — they get the SDK from
 * `xcode-select`/`xcrun` (see `detectMacosSdk()` in config.ts). When the host
 * is not darwin there is no Xcode, so the SDK comes from (in order):
 *
 *   1. `--macos-sdk=<path>` / `$MACOS_SDK_PATH` — explicit, always wins.
 *   2. A well-known install location (`/opt/MacOSX*.sdk`, an osxcross tree).
 *   3. `<cacheDir>/MacOSX<version>.sdk` — downloaded on demand at configure
 *      time from the same mirror bootstrap.sh's `--osxcross` feature already
 *      uses (github.com/alexey-lysiuk/macos-sdk), then cached like the WebKit
 *      prebuilt. ~50 MB download, ~730 MB extracted.
 *
 * Only the SDK is needed — no osxcross, no cctools. clang is inherently a
 * cross-compiler and lld's Mach-O port (`ld64.lld`) does the link, so the
 * sysroot (headers + .tbd stubs + frameworks) is the only Apple bit required.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { downloadWithRetry } from "./download.ts";
import { BuildError } from "./error.ts";

/**
 * Pinned SDK version for the auto-download path. Newer SDKs list more
 * symbols in their .tbd stubs (required when the WebKit prebuilt was built
 * against a newer SDK than ours), and the deployment target — not the SDK —
 * controls the oldest macOS the binary runs on, so tracking a recent SDK is
 * the safe direction. Bump when github.com/alexey-lysiuk/macos-sdk publishes
 * a newer release worth tracking.
 */
export const MACOS_SDK_VERSION = "15.5";

/** Download URL for the pinned SDK tarball. */
export function macosSdkUrl(version: string = MACOS_SDK_VERSION): string {
  return `https://github.com/alexey-lysiuk/macos-sdk/releases/download/${version}/MacOSX${version}.tar.xz`;
}

/** `<cacheDir>/MacOSX<version>.sdk` — where the auto-download lands. */
export function macosSdkCachePath(cacheDir: string, version: string = MACOS_SDK_VERSION): string {
  return resolve(cacheDir, `MacOSX${version}.sdk`);
}

/** A directory "looks like" a macOS SDK if it has the C headers we need. */
function isMacosSdk(path: string): boolean {
  return existsSync(join(path, "usr", "include", "sys", "syscall.h"));
}

/**
 * Pick the highest-versioned `MacOSX*.sdk` under `dir`, or undefined.
 * `MacOSX.sdk` (unversioned symlink, Xcode-style layout) wins if present.
 */
function newestSdkIn(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const unversioned = join(dir, "MacOSX.sdk");
  if (isMacosSdk(unversioned)) return unversioned;
  let best: { version: number; path: string } | undefined;
  for (const entry of readdirSync(dir)) {
    const m = entry.match(/^MacOSX(\d+)(?:\.(\d+))?\.sdk$/);
    if (!m) continue;
    const path = join(dir, entry);
    if (!isMacosSdk(path)) continue;
    const version = Number(m[1]) * 100 + Number(m[2] ?? 0);
    if (best === undefined || version > best.version) best = { version, path };
  }
  return best?.path;
}

/**
 * Resolve the macOS SDK path for a cross build. Does NOT download — that
 * happens later in `ensureMacosSdk()` (configure is sync, downloads aren't).
 * The returned path may not exist yet when it's the cache-dir default.
 */
export function resolveMacosSdkPath(explicit: string | undefined, cacheDir: string, cwd: string): string {
  // 1. Explicit: --macos-sdk= or $MACOS_SDK_PATH. Must exist — a typo'd
  //    explicit path silently falling back to a download would be confusing.
  const requested = explicit ?? process.env.MACOS_SDK_PATH;
  if (requested !== undefined && requested !== "") {
    const abs = resolve(cwd, requested);
    if (!isMacosSdk(abs)) {
      throw new BuildError(`macOS SDK not found at ${abs}`, {
        hint: "Expected a MacOSX*.sdk directory (containing usr/include). Check --macos-sdk / MACOS_SDK_PATH.",
      });
    }
    return abs;
  }

  // 2. Well-known install locations: /opt/MacOSX*.sdk (what CI images /
  //    bootstrap install) or an osxcross tree.
  for (const candidate of [newestSdkIn("/opt"), newestSdkIn("/opt/macos-sdk"), newestSdkIn("/opt/osxcross/SDK")]) {
    if (candidate !== undefined) return candidate;
  }

  // 3. The cache dir — a previous auto-download of the *pinned* version is
  //    reused as-is; any other MacOSX*.sdk in there is deliberately ignored so
  //    that bumping MACOS_SDK_VERSION fetches the new pin instead of silently
  //    reusing a stale SDK. ensureMacosSdk() downloads into this path when it
  //    doesn't exist yet.
  return macosSdkCachePath(cacheDir);
}

/**
 * Make sure `cfg.osxSysroot` exists on disk, downloading the pinned SDK into
 * the cache dir when that's where resolveMacosSdkPath() pointed. Called from
 * configure() before ninja runs so compile edges never race the extraction.
 */
export async function ensureMacosSdk(cfg: {
  osxSysroot: string | undefined;
  cacheDir: string;
  darwin: boolean;
  host: { os: string };
}): Promise<void> {
  if (!cfg.darwin || cfg.host.os === "darwin" || cfg.osxSysroot === undefined) return;
  if (isMacosSdk(cfg.osxSysroot)) return;

  const expected = macosSdkCachePath(cfg.cacheDir);
  if (resolve(cfg.osxSysroot) !== expected) {
    // A non-default path that doesn't exist: never overwrite/auto-fill a
    // user-specified location.
    throw new BuildError(`macOS SDK not found at ${cfg.osxSysroot}`, {
      hint:
        `Install a macOS SDK there, or unset MACOS_SDK_PATH/--macos-sdk to let the build ` +
        `download MacOSX${MACOS_SDK_VERSION}.sdk into ${expected}.`,
    });
  }

  const url = macosSdkUrl();
  console.log(`[macos-sdk] downloading MacOSX${MACOS_SDK_VERSION}.sdk (targeting macOS from a ${cfg.host.os} host)`);
  console.log(`[macos-sdk] ${url}`);

  // Download + extract with the same staging-then-rename discipline as
  // fetchPrebuilt() so an interrupted configure never leaves a half-extracted
  // tree claiming to be an SDK.
  const suffix = `.${process.pid}.${Date.now().toString(36)}`;
  const tarball = `${expected}${suffix}.tar.xz`;
  const staging = `${expected}${suffix}.staging`;
  await mkdir(cfg.cacheDir, { recursive: true });
  await downloadWithRetry(url, tarball, "macos-sdk");

  try {
    await mkdir(staging, { recursive: true });
    // -J: the SDK tarballs are .tar.xz (GNU tar + bsdtar both take -J; xz
    // itself ships on every supported build host / CI image).
    const result = spawnSync("tar", ["-xJmf", tarball, "-C", staging], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
      throw new BuildError(`Failed to extract ${basename(tarball)}: ${result.stderr || result.error?.message}`, {
        hint: "Extraction needs `tar` with xz support (apt install xz-utils).",
      });
    }
    // Tarball layout: single top-level MacOSX<version>.sdk directory.
    const top = readdirSync(staging).find(e => /^MacOSX.*\.sdk$/.test(e));
    if (top === undefined || !isMacosSdk(join(staging, top))) {
      throw new BuildError(`Unexpected macOS SDK tarball layout (no MacOSX*.sdk in ${basename(tarball)})`);
    }
    await rm(expected, { recursive: true, force: true });
    await rename(join(staging, top), expected);
    console.log(`[macos-sdk] extracted to ${expected}`);
  } finally {
    await rm(tarball, { force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
