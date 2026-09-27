/**
 * Windows sysroot (xwin splat) handling for Windows targets.
 *
 * Building for Windows needs the MSVC CRT/STL + Windows SDK + ATL headers
 * and import libraries (see `Config.winsysroot`), and nothing else of Visual
 * Studio: the compiler, linker and resource compiler are LLVM's. Provisioned
 * sysroots come from the agent image (the `windowsSysroot` tool of ci-images/spec.ts bakes
 * an xwin splat at /opt/winsysroot) or from a
 * developer-created splat (docs/project/building-windows.mdx). When none is
 * present, CI builds and builds on a Windows host fetch one into the cache
 * dir at configure time, so a build on Windows links what the shipped binary
 * links, whatever the machine has installed.
 *
 * The fetch is two steps, both pinned:
 *   1. Download the xwin release binary for the build host (GitHub).
 *   2. Run `xwin splat` — xwin downloads the CRT/SDK/ATL packages from
 *      Microsoft's CDN and lays them out like a Visual Studio install so a
 *      single `/winsysroot` flag works for clang-cl and lld-link.
 *      `--accept-license` accepts Microsoft's license terms for those
 *      components (the same terms the Windows CI images accept when
 *      installing VS Build Tools). CI accepts them; a person's build stops
 *      before fetching until it is run with `--accept-microsoft-licenses`.
 *
 * Idempotent: a sentinel check (SDK include + lib trees with the target
 * arch's kernel32 import lib, plus the ATL headers) makes re-runs a no-op,
 * so calling this on every build only costs time when the sysroot is
 * genuinely absent or incomplete.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pins } from "./ci-images/spec.ts";
import type { Arch, Config } from "./config.ts";
import { downloadWithRetry, extractTarGz, extractZip } from "./download.ts";
import { BuildError } from "./error.ts";

/** Pinned xwin release — https://github.com/Jake-Shadle/xwin/releases. The CI build image's sysroot is made with the same one. */
export const XWIN_VERSION = pins.windowsSysroot.xwin;

/**
 * The Windows SDK and MSVC CRT versions the splat is pinned to. Passing them
 * to xwin explicitly means a Visual Studio manifest update can't silently
 * move the toolchain to a different SDK/CRT — the targeted Windows version
 * and API surface stay put until these are bumped on purpose.
 */
export const WINDOWS_SDK_VERSION = pins.windowsSysroot.sdk;
export const MSVC_CRT_VERSION = pins.windowsSysroot.crt;

/** Where the build fetches a sysroot nobody provided. Named for its pins, so bumping one fetches another. */
export function windowsSysrootCachePath(cacheDir: string): string {
  return resolve(cacheDir, `winsysroot-${WINDOWS_SDK_VERSION}-${MSVC_CRT_VERSION}`);
}

/**
 * Serviced Universal CRT static libraries, fetched from the official
 * `Microsoft.Windows.SDK.CPP.<arch>` NuGet packages and laid over the xwin
 * splat at link time (a /libpath: ahead of /winsysroot).
 *
 * Why: the "Universal CRT Headers Libraries and Sources" payload in the VS
 * manifest (what xwin downloads, any xwin version) still carries an ancient
 * arm64 build of the UCRT whose `__stdio_common_vsprintf` mis-formats on
 * ARM64 — c-ares's discovered DNS servers came out as garbage and every
 * printf-family call in the binary was suspect. The SDK NuGet ships the same
 * SDK version's *serviced* libs (the ones a real Visual Studio install has),
 * with a current-MSVC, pointer-auth-instrumented arm64 UCRT. Same SDK, same
 * headers, same minimum Windows version — only the static lib binaries are
 * newer.
 */
export const UCRT_SERVICING_VERSION = "10.0.26100.8249";

/**
 * Resolve a directory entry whose on-disk casing varies. A real Visual
 * Studio / Windows SDK copy uses title-case ("Include", "Lib",
 * "kernel32.Lib"); an xwin splat in winsysroot-style mode writes lowercase
 * and relies on symlink aliases for the rest (see ensureSdkCaseAliases).
 */
function joinIgnoreCase(parent: string, name: string): string | undefined {
  for (const candidate of [name, name.toLowerCase()]) {
    const p = join(parent, candidate);
    if (existsSync(p)) return p;
  }
  return undefined;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** MS arch notation used for per-arch lib dirs inside the SDK. */
function msArchName(arch: Arch): string {
  return arch === "x64" ? "x64" : "arm64";
}

/**
 * Does `dir` look like a winsysroot usable for an `arch` build? Checks the
 * SDK include tree, the kernel32 import lib for the target arch, and the ATL
 * headers so an interrupted or pre-ATL splat isn't treated as complete.
 * Mirrors `detectWindowsSysroot()`'s sentinel (config.ts), with the extra
 * lib/ATL checks. Case-tolerant: accepts both the SDK's title-case layout
 * and xwin's lowercase winsysroot-style layout.
 */
export function isCompleteWindowsSysroot(dir: string, arch: Arch): boolean {
  const sdkRoot = join(dir, "Windows Kits", "10");
  const sdkInclude = joinIgnoreCase(sdkRoot, "Include");
  const sdkLib = joinIgnoreCase(sdkRoot, "Lib");
  if (sdkInclude === undefined || sdkLib === undefined) return false;
  // The SDK ships the file as "kernel32.Lib"; xwin adds a lowercase symlink.
  const hasKernel32 = listDir(sdkLib).some(ver =>
    listDir(join(sdkLib, ver, "um", msArchName(arch))).some(f => f.toLowerCase() === "kernel32.lib"),
  );
  if (!hasKernel32) return false;
  // ATL (<atlstr.h>, needed by src/jsc/bindings/windows/rescle.cpp): xwin's
  // --include-atl merges the ATL headers into the VC include dir; a real
  // Visual Studio copy keeps them under atlmfc/include.
  const msvcRoot = join(dir, "VC", "Tools", "MSVC");
  return listDir(msvcRoot).some(ver =>
    [join(msvcRoot, ver, "include"), join(msvcRoot, ver, "atlmfc", "include")].some(incDir =>
      listDir(incDir).some(f => f.toLowerCase() === "atlstr.h"),
    ),
  );
}

/**
 * clang-cl and lld-link compose SDK paths under /winsysroot with title-case
 * "Include" and "Lib" (llvm/lib/WindowsDriver/MSVCPaths.cpp,
 * lld/COFF/Driver.cpp), but xwin's winsysroot-style splat writes lowercase
 * "include"/"lib" and only creates title-case aliases for its non-winsysroot
 * layout. On a case-sensitive filesystem the toolchain would find nothing,
 * so make sure both spellings resolve, whichever one the sysroot shipped
 * with. No-op when the alias (or a real title-case dir) already exists.
 */
function ensureSdkCaseAliases(dir: string): void {
  const sdkRoot = join(dir, "Windows Kits", "10");
  if (!existsSync(sdkRoot)) return;
  for (const [alias, real] of [
    ["Include", "include"],
    ["Lib", "lib"],
  ] as const) {
    const aliasPath = join(sdkRoot, alias);
    if (existsSync(aliasPath) || !existsSync(join(sdkRoot, real))) continue;
    try {
      symlinkSync(real, aliasPath);
    } catch (error) {
      // EEXIST: another configure raced us (or a dangling alias is present) —
      // either way the path resolves or the compile error will say so.
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new BuildError(`Could not create the "${alias}" alias in ${sdkRoot}`, {
        cause: error as Error,
        hint: `clang-cl/lld-link look up Windows SDK paths as "${alias}". Create the alias manually: ln -s ${real} "${aliasPath}"`,
      });
    }
  }
}

/**
 * Before anything of Microsoft's is fetched. Both fetches come from Microsoft
 * itself, and each is under terms its usual installer has the user accept:
 * xwin asks (`--accept-license` answers for them), and the NuGet package is
 * marked `requireLicenseAcceptance`.
 */
function requireMicrosoftLicenses(cfg: Config): void {
  if (cfg.acceptMicrosoftLicenses) return;
  throw new BuildError(
    "Building for Windows needs the MSVC C++ runtime and the Windows SDK, which are not in the cache",
    {
      hint: [
        "The build downloads them from Microsoft (about 450 MB, once per machine). They are under Microsoft's license terms:",
        "  Visual Studio Build Tools  https://go.microsoft.com/fwlink/?LinkId=2086102",
        "  Windows SDK                https://aka.ms/WinSDKLicenseURL",
        "If you accept them, run this build again with --accept-microsoft-licenses",
      ].join("\n        "),
    },
  );
}

/** xwin release triple for the machine running the build. */
function xwinHostTriple(cfg: Config): string {
  const arch = cfg.host.arch === "aarch64" ? "aarch64" : "x86_64";
  switch (cfg.host.os) {
    case "linux":
      return `${arch}-unknown-linux-musl`;
    case "darwin":
      return `${arch}-apple-darwin`;
    case "windows":
      // The only Windows release. An arm64 machine emulates it.
      return "x86_64-pc-windows-msvc";
    default:
      throw new BuildError(`No xwin release for host ${cfg.host.os}-${cfg.host.arch}`, {
        hint: "Provide a Windows sysroot via WINDOWS_SYSROOT / --winsysroot instead.",
      });
  }
}

/**
 * Ensure `cfg.winsysroot` exists, is complete for the target arch, and has
 * the case aliases the LLVM toolchain needs. Fetches the sysroot with xwin
 * when it's missing, in CI or at the build's own place in the cache; a local
 * build gets a clear error instead of a surprise download into a directory
 * its user configured.
 */
export async function ensureWindowsSysroot(cfg: Config): Promise<void> {
  if (cfg.winsysroot === undefined) return;
  const dest = cfg.winsysroot;

  if (!isCompleteWindowsSysroot(dest, cfg.arch)) {
    if (!cfg.ci && !cfg.buildkite && dest !== windowsSysrootCachePath(cfg.cacheDir)) {
      throw new BuildError(`Windows sysroot at ${dest} is missing the MSVC CRT / Windows SDK / ATL for ${cfg.arch}`, {
        hint:
          "Re-create it with xwin (see docs/project/building-windows.mdx):\n" +
          `  xwin --accept-license --arch x86_64,aarch64 --sdk-version ${WINDOWS_SDK_VERSION} --crt-version ${MSVC_CRT_VERSION} --include-atl splat --use-winsysroot-style --preserve-ms-arch-notation --include-debug-libs --output ${dest}`,
      });
    }
    await fetchWindowsSysroot(cfg, dest);
  }

  ensureSdkCaseAliases(dest);
  await ensureUcrtServicingOverlay(cfg);
}

/**
 * Directory holding the serviced UCRT static libs for the target arch (see
 * UCRT_SERVICING_VERSION). The link adds it as /libpath: ahead of the
 * winsysroot so these win over the splat's stale copies. Undefined for
 * builds against the installed, already-serviced SDK (msvc.ts).
 */
export function ucrtServicingLibDir(cfg: Config): string | undefined {
  if (cfg.winsysroot === undefined) return undefined;
  return join(cfg.cacheDir, `ucrt-servicing-${UCRT_SERVICING_VERSION}`, msArchName(cfg.arch));
}

/** Fetch the serviced UCRT libs from the Microsoft.Windows.SDK.CPP NuGet. */
async function ensureUcrtServicingOverlay(cfg: Config): Promise<void> {
  const libDir = ucrtServicingLibDir(cfg);
  if (libDir === undefined) return;
  // libucrt.lib is the member that matters (static CRT); ucrt.lib comes along
  // for /MD-style links of tooling. Presence of both = done.
  const isComplete = (dir: string) => existsSync(join(dir, "libucrt.lib")) && existsSync(join(dir, "ucrt.lib"));
  if (isComplete(libDir)) return;
  requireMicrosoftLicenses(cfg);

  const arch = msArchName(cfg.arch);
  const pkg = `microsoft.windows.sdk.cpp.${arch}`;
  const url = `https://api.nuget.org/v3-flatcontainer/${pkg}/${UCRT_SERVICING_VERSION}/${pkg}.${UCRT_SERVICING_VERSION}.nupkg`;
  const stagingDir = stagingBeside(libDir);
  const nupkg = join(stagingDir, `${pkg}.nupkg`);

  console.log(`fetching serviced UCRT libs (${pkg} ${UCRT_SERVICING_VERSION})`);
  await downloadWithRetry(url, nupkg, "ucrt-servicing");
  await extractZip(nupkg, stagingDir);

  const extractedUcrt = join(stagingDir, "c", "ucrt", arch);
  if (!existsSync(join(extractedUcrt, "libucrt.lib"))) {
    throw new BuildError(`Serviced UCRT libs not found in ${pkg} ${UCRT_SERVICING_VERSION}`, {
      hint: `Expected c/ucrt/${arch}/libucrt.lib inside the NuGet package — its layout may have changed.`,
    });
  }
  const libs = join(stagingDir, "libs");
  mkdirSync(libs);
  for (const file of readdirSync(extractedUcrt)) {
    if (file.toLowerCase().endsWith(".lib")) {
      copyFileSync(join(extractedUcrt, file), join(libs, file));
    }
  }
  publishToCache(libs, libDir, isComplete);
  rmSync(stagingDir, { recursive: true, force: true });
}

/** Download xwin and splat the MSVC CRT + Windows SDK into `dest`. */
async function fetchWindowsSysroot(cfg: Config, dest: string): Promise<void> {
  requireMicrosoftLicenses(cfg);

  // ─── 1. xwin binary ───
  const triple = xwinHostTriple(cfg);
  const xwinDir = resolve(cfg.cacheDir, `xwin-${XWIN_VERSION}`);
  const xwinExe = join(xwinDir, `xwin-${XWIN_VERSION}-${triple}`, `xwin${cfg.host.exeSuffix}`);
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

  // ─── 2. Splat the MSVC CRT + Windows SDK + ATL ───
  // Both target arches in one splat; --include-debug-libs so /MTd (debug
  // CRT) links work; --include-atl for <atlstr.h> (rescle.cpp);
  // winsysroot-style + MS arch notation so clang-cl and lld-link resolve it
  // with a single /winsysroot flag; symlinks stay ON (default) to fix
  // include/lib casing on a case-sensitive filesystem, and are OFF on
  // Windows, which has none and lets only privileged users create them.
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
  // Splat beside `dest` and rename: every checkout on the machine shares the
  // cache, and a build must never see another's half-written sysroot.
  const staging = stagingBeside(dest);
  const splat = join(staging, "sysroot");
  const args = [
    "--accept-license",
    "--arch",
    "x86_64,aarch64",
    // Pin the SDK + CRT so a manifest refresh can't drift the toolchain.
    "--sdk-version",
    WINDOWS_SDK_VERSION,
    "--crt-version",
    MSVC_CRT_VERSION,
    // Top-level option (payload selection), not a `splat` option.
    "--include-atl",
    "--cache-dir",
    join(staging, "dl"),
    "splat",
    "--use-winsysroot-style",
    "--preserve-ms-arch-notation",
    "--include-debug-libs",
    ...(cfg.host.os === "windows" ? ["--disable-symlinks"] : []),
    "--output",
    splat,
  ];
  // Microsoft's CDN resets connections often enough that agents without a
  // baked sysroot were failing real builds on it — retry the whole splat a
  // couple of times before giving up (the package cache beside the splat
  // makes retries cheap; the splat output dir is wiped each attempt so a
  // partial extraction can't leak through).
  const attempts = 3;
  let result;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    rmSync(splat, { recursive: true, force: true });
    mkdirSync(splat, { recursive: true });
    // xwin draws progress bars to stdout even when it isn't a terminal, which
    // floods CI logs with megabytes of redraws. Keep stderr (real errors);
    // only show the progress locally where it's actually a progress bar.
    result = spawnSync(xwinExe, args, {
      stdio: ["ignore", process.stdout.isTTY ? "inherit" : "ignore", "inherit"],
    });
    if (!result.error && result.status === 0) {
      break;
    }
    if (attempt < attempts) {
      console.warn(
        `xwin splat failed${result.status !== null ? ` (exit ${result.status})` : ""}, retrying (${attempt}/${attempts - 1} retries used)`,
      );
    }
  }
  if (result!.error || result!.status !== 0) {
    rmSync(staging, { recursive: true, force: true });
    throw new BuildError(`xwin splat failed${result!.status !== null ? ` (exit ${result!.status})` : ""}`, {
      cause: result!.error,
      hint: "The MSVC CRT / Windows SDK download from Microsoft's CDN failed — check network access, or provide a sysroot via WINDOWS_SYSROOT / --winsysroot.",
    });
  }
  try {
    if (!isCompleteWindowsSysroot(splat, cfg.arch)) {
      throw new BuildError(`xwin splat finished but is missing expected SDK files`, {
        hint: "Retry, or provide a sysroot via WINDOWS_SYSROOT / --winsysroot.",
      });
    }
    publishToCache(splat, dest, dir => isCompleteWindowsSysroot(dir, cfg.arch));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Move `staged`, which is finished, to `dest` in a cache that other builds
 * share. A build that fetched the same thing meanwhile and published first is
 * reading its own by now, so that one stays.
 */
export function publishToCache(
  staged: string,
  dest: string,
  isComplete: (dir: string) => boolean,
  rename: (from: string, to: string) => void = renameSync,
): void {
  if (isComplete(dest)) return;
  rmSync(dest, { recursive: true, force: true });
  for (let attempt = 1; ; attempt++) {
    try {
      return rename(staged, dest);
    } catch (cause) {
      // Published between the check and here.
      if (isComplete(dest)) return;
      // Windows refuses to move a directory while anything in it is open, and an antivirus opens what is new.
      const held = ["EPERM", "EACCES", "EBUSY"].includes((cause as NodeJS.ErrnoException).code ?? "");
      if (!held || attempt === 10) throw new BuildError(`Could not move ${staged} to ${dest}`, { cause });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

/**
 * A new directory beside `dest` for this process to fetch into. It is named
 * for the process, so two that fetch at once do not share one, and what an
 * interrupted fetch left behind is known by its process being gone. Nothing
 * else would ever remove that, so this does.
 */
export function stagingBeside(dest: string): string {
  const prefix = `${basename(dest)}.staging-`;
  for (const name of listDir(dirname(dest))) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length));
    if (pid === process.pid || !isRunning(pid)) rmSync(join(dirname(dest), name), { recursive: true, force: true });
  }
  const staging = `${dest}.staging-${process.pid}`;
  mkdirSync(staging, { recursive: true });
  return staging;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"; // someone else's, but running
  }
}
