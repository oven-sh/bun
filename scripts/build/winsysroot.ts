/**
 * Windows sysroot (xwin splat) fetcher — CI path for Windows cross-compiles.
 *
 * Cross-compiling for Windows needs the MSVC CRT/STL + Windows SDK headers
 * and import libraries (see `Config.winsysroot`). Local builds point at a
 * sysroot the developer created once (docs/project/building-windows.mdx);
 * CI always fetches one into the per-build cache dir so the build doesn't
 * depend on what the agent image happens to carry.
 *
 * The fetch is two steps, both pinned:
 *   1. Download the xwin release binary for the build host (GitHub).
 *   2. Run `xwin splat` — xwin downloads the CRT/SDK packages from
 *      Microsoft's CDN and lays them out like a Visual Studio install so a
 *      single `/winsysroot` flag works for clang-cl and lld-link.
 *      `--accept-license` accepts Microsoft's license terms for those
 *      components (the same terms the Windows CI images accept when
 *      installing VS Build Tools).
 *
 * Idempotent: a sentinel check (SDK include dir + kernel32.lib import libs
 * for both arches) makes re-runs a no-op, so calling this on every CI build
 * only costs time when the cache dir is fresh.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Config } from "./config.ts";
import { downloadWithRetry, extractTarGz } from "./download.ts";
import { BuildError } from "./error.ts";

/** Pinned xwin release — https://github.com/Jake-Shadle/xwin/releases */
export const XWIN_VERSION = "0.6.7";

/**
 * Does `dir` look like a complete winsysroot? Checks the SDK include tree
 * plus the kernel32 import lib for both target arches so an interrupted
 * splat isn't treated as complete. Mirrors `detectWindowsSysroot()`'s
 * sentinel (config.ts), with the extra per-arch lib check.
 */
export function isCompleteWindowsSysroot(dir: string): boolean {
  const sdkLib = join(dir, "Windows Kits", "10", "Lib");
  if (!existsSync(join(dir, "Windows Kits", "10", "Include")) || !existsSync(sdkLib)) return false;
  for (const arch of ["x64", "arm64"]) {
    const found = sdkVersionDirs(sdkLib).some(ver => existsSync(join(sdkLib, ver, "um", arch, "kernel32.lib")));
    if (!found) return false;
  }
  return true;
}

function sdkVersionDirs(sdkLib: string): string[] {
  try {
    return readdirSync(sdkLib);
  } catch {
    return [];
  }
}

/** xwin release triple for the machine running the build. */
function xwinHostTriple(cfg: Config): string {
  const arch = cfg.host.arch === "aarch64" ? "aarch64" : "x86_64";
  switch (cfg.host.os) {
    case "linux":
      return `${arch}-unknown-linux-musl`;
    case "darwin":
      return `${arch}-apple-darwin`;
    default:
      throw new BuildError(`No xwin release for host ${cfg.host.os}-${cfg.host.arch}`, {
        hint: "Provide a Windows sysroot via WINDOWS_SYSROOT / --winsysroot instead.",
      });
  }
}

/**
 * Ensure `cfg.winsysroot` exists and is complete, fetching it with xwin if
 * not. No-op for native Windows builds and when the sysroot is already
 * present (the common case locally).
 */
export async function ensureWindowsSysroot(cfg: Config): Promise<void> {
  if (!cfg.windows || cfg.host.os === "windows" || cfg.winsysroot === undefined) return;
  const dest = cfg.winsysroot;
  if (isCompleteWindowsSysroot(dest)) return;

  // ─── 1. xwin binary ───
  const triple = xwinHostTriple(cfg);
  const xwinDir = resolve(cfg.cacheDir, `xwin-${XWIN_VERSION}`);
  const xwinExe = join(xwinDir, `xwin-${XWIN_VERSION}-${triple}`, "xwin");
  if (!existsSync(xwinExe)) {
    const url = `https://github.com/Jake-Shadle/xwin/releases/download/${XWIN_VERSION}/xwin-${XWIN_VERSION}-${triple}.tar.gz`;
    const tarball = join(xwinDir, `xwin-${triple}.tar.gz`);
    mkdirSync(xwinDir, { recursive: true });
    console.log(`downloading ${url}`);
    await downloadWithRetry(url, tarball, "xwin");
    // Keep the release's top-level dir (strip=0) so the exe path is stable.
    await extractTarGz(tarball, xwinDir, 0);
    if (!existsSync(xwinExe)) {
      throw new BuildError(`xwin binary not found after extraction: ${xwinExe}`);
    }
  }

  // ─── 2. Splat the MSVC CRT + Windows SDK ───
  // Both target arches in one splat; --include-debug-libs so /MTd (debug
  // CRT) links work; winsysroot-style + MS arch notation so clang-cl and
  // lld-link resolve it with a single /winsysroot flag; symlinks stay ON
  // (default) to fix include casing on a case-sensitive filesystem.
  //
  // The incomplete previous attempt is wiped before re-splatting, but only
  // when `dest` actually looks like a (partial) sysroot — a mistyped
  // WINDOWS_SYSROOT / --winsysroot pointing at real data should error, not
  // be deleted. dirname(dest) === dest catches "/" and drive roots.
  if (!isAbsolute(dest) || dirname(dest) === dest) {
    throw new BuildError(`Refusing to create a Windows sysroot at ${JSON.stringify(dest)}`, {
      hint: "WINDOWS_SYSROOT / --winsysroot must be an absolute, non-root directory.",
    });
  }
  if (existsSync(dest)) {
    const looksLikeSysroot =
      existsSync(join(dest, "Windows Kits")) || existsSync(join(dest, "VC")) || readdirSync(dest).length === 0;
    if (!looksLikeSysroot) {
      throw new BuildError(`Refusing to replace ${dest}: it exists but does not look like a Windows sysroot`, {
        hint: "Point WINDOWS_SYSROOT / --winsysroot at an xwin splat (or an empty directory), or delete it manually if it should be re-created.",
      });
    }
  }
  console.log(`fetching MSVC CRT + Windows SDK into ${dest} (xwin splat)`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const args = [
    "--accept-license",
    "--arch",
    "x86_64,aarch64",
    "--cache-dir",
    join(cfg.cacheDir, "xwin-dl"),
    "splat",
    "--use-winsysroot-style",
    "--preserve-ms-arch-notation",
    "--include-debug-libs",
    "--output",
    dest,
  ];
  const result = spawnSync(xwinExe, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new BuildError(`xwin splat failed${result.status !== null ? ` (exit ${result.status})` : ""}`, {
      cause: result.error,
      hint: "The MSVC CRT / Windows SDK download from Microsoft's CDN failed — check network access, or provide a sysroot via WINDOWS_SYSROOT / --winsysroot.",
    });
  }
  if (!isCompleteWindowsSysroot(dest)) {
    throw new BuildError(`xwin splat finished but ${dest} is missing expected SDK files`, {
      hint: "Delete the directory and retry, or provide a sysroot via WINDOWS_SYSROOT / --winsysroot.",
    });
  }
}
