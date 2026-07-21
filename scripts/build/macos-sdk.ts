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
 *   3. `<cacheDir>/MacOSX<version>.sdk` — extracted on demand at configure
 *      time by the vendored `xmac` tool (scripts/build/xmac.mjs), which
 *      downloads the Command Line Tools SDK package (~60 MB) directly from
 *      Apple's public software-update CDN — the same approach `xwin` uses for
 *      the Windows SDK. Nothing is fetched from a third-party mirror and
 *      nothing is redistributed; every machine downloads from Apple itself.
 *
 * Only the SDK is needed — no osxcross, no cctools. clang is inherently a
 * cross-compiler and lld's Mach-O port (`ld64.lld`) does the link, so the
 * sysroot (headers + .tbd stubs + frameworks) is the only Apple bit required.
 *
 * The deployment target (`-mmacosx-version-min`, `cfg.osxDeploymentTarget`)
 * — not the SDK version — controls the oldest macOS the binary runs on, so
 * the pin tracks the newest SDK Apple serves: newer SDKs list more symbols in
 * their `.tbd` stubs (required when the WebKit prebuilt was built against a
 * newer SDK than ours) and that is the only direction that can't break the
 * link.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BuildError } from "./error.ts";

/**
 * Pinned SDK + Command Line Tools release for the auto-extract path. Apple's
 * software-update catalog is a rolling window — old CLT releases eventually
 * stop being served — so when the build fails saying the release is gone, run
 * `bun scripts/build/xmac.mjs list` and bump both pins to the newest entry.
 */
export const MACOS_SDK_VERSION = "26.5";
/** The Command Line Tools release whose package contains MACOS_SDK_VERSION. */
export const MACOS_SDK_CLT_RELEASE = "26.5";

/** The vendored xmac bundle (see the header of that file for provenance). */
export const XMAC_PATH = join(import.meta.dirname, "xmac.mjs");

/** `<cacheDir>/MacOSX<version>.sdk` — where the auto-extract lands. */
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

  // 3. The cache dir — a previous auto-extract of the *pinned* version is
  //    reused as-is; any other MacOSX*.sdk in there is deliberately ignored so
  //    that bumping MACOS_SDK_VERSION fetches the new pin instead of silently
  //    reusing a stale SDK. ensureMacosSdk() extracts into this path when it
  //    doesn't exist yet.
  return macosSdkCachePath(cacheDir);
}

/**
 * Make sure `cfg.osxSysroot` exists on disk, downloading + extracting the
 * pinned SDK into the cache dir when that's where resolveMacosSdkPath()
 * pointed. Called from configure() before ninja runs so compile edges never
 * race the extraction.
 */
export async function ensureMacosSdk(cfg: {
  osxSysroot: string | undefined;
  cacheDir: string;
  darwin: boolean;
  jsRuntimeArgv: string[];
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
        `fetch MacOSX${MACOS_SDK_VERSION}.sdk from Apple into ${expected}.`,
    });
  }

  // The SDK is Apple's, under the "macOS SDK and Xcode Agreement". xmac
  // downloads it from Apple's own CDN to this machine (nothing is
  // redistributed), but extracting and using it means accepting Apple's
  // terms — say so before passing --accept-license on the user's behalf.
  console.log(`[macos-sdk] targeting macOS from a ${cfg.host.os} host; fetching MacOSX${MACOS_SDK_VERSION}.sdk`);
  console.log(`[macos-sdk] the SDK is downloaded directly from Apple's software-update CDN and is subject to`);
  console.log(
    `[macos-sdk] Apple's SDK license terms (https://www.apple.com/legal/sla/ — \`bun ${relativeXmac()} license\`).`,
  );

  // Extract into a staging dir, then rename the .sdk into place — same
  // discipline as fetchPrebuilt() so an interrupted configure never leaves a
  // half-extracted tree claiming to be an SDK. The downloaded .pkg itself is
  // cached separately under <cacheDir>/xmac so a failed/interrupted
  // extraction doesn't re-download ~60 MB.
  const suffix = `.${process.pid}.${Date.now().toString(36)}`;
  const staging = `${expected}${suffix}.staging`;
  await mkdir(cfg.cacheDir, { recursive: true });

  try {
    const [rt, ...rtArgs] = cfg.jsRuntimeArgv;
    const result = spawnSync(
      rt,
      [
        ...rtArgs,
        XMAC_PATH,
        "splat",
        "--accept-license",
        "--sdk-only",
        "--release",
        MACOS_SDK_CLT_RELEASE,
        "--sdk",
        MACOS_SDK_VERSION,
        "--output",
        staging,
        "--cache-dir",
        join(cfg.cacheDir, "xmac"),
      ],
      // Progress goes to the terminal (stderr); the `key: value` result lines
      // on stdout are not needed — the output layout is deterministic.
      { stdio: ["ignore", "inherit", "inherit"], encoding: "utf8" },
    );
    if (result.error || result.status !== 0) {
      throw new BuildError(
        `Failed to fetch MacOSX${MACOS_SDK_VERSION}.sdk from Apple's CDN` +
          (result.error ? `: ${result.error.message}` : ` (exit ${result.status})`),
        {
          hint:
            `Apple's software-update catalog is a rolling window; if Command Line Tools ` +
            `${MACOS_SDK_CLT_RELEASE} is no longer served, run \`bun ${relativeXmac()} list\` and bump ` +
            `MACOS_SDK_VERSION / MACOS_SDK_CLT_RELEASE in scripts/build/macos-sdk.ts. ` +
            `Extraction also needs \`xz\` on PATH (apt install xz-utils).`,
        },
      );
    }

    // xmac's splat layout is `<output>/SDKs/<name>.sdk` (plus version-alias
    // symlinks); move the one real SDK directory to the flat cache path the
    // rest of the build expects.
    const extracted = join(staging, "SDKs", `MacOSX${MACOS_SDK_VERSION}.sdk`);
    if (!isMacosSdk(extracted)) {
      throw new BuildError(`xmac did not produce ${extracted}`, {
        hint: `Expected MacOSX${MACOS_SDK_VERSION}.sdk inside the Command Line Tools ${MACOS_SDK_CLT_RELEASE} package.`,
      });
    }
    await rm(expected, { recursive: true, force: true });
    await rename(extracted, expected);
    console.log(`[macos-sdk] extracted to ${expected}`);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/** `scripts/build/xmac.mjs` relative to the repo root, for log messages. */
function relativeXmac(): string {
  return "scripts/build/xmac.mjs";
}
