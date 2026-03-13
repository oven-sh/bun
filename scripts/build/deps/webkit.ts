/**
 * WebKit commit — determines prebuilt download URL + what to checkout
 * for local mode. Override via `--webkit-version=<hash>` to test a branch.
 * From https://github.com/oven-sh/WebKit releases.
 */
export const WEBKIT_VERSION = "00e825523d549a556d75985f486e4954af6ab8c7";

/**
 * WebKit (JavaScriptCore) — the JS engine.
 *
 * Two modes via `cfg.webkit`:
 *
 * **prebuilt**: Download tarball from oven-sh/WebKit releases. Tarball name
 *   encodes {os, arch, musl, debug|lto, asan} — each is a separate ABI.
 *   ASAN MUST match bun's setting: WTF::Vector layout changes with ASAN
 *   (see WTF/Vector.h:682), so mixing → silent memory corruption.
 *
 * **local**: Source at `vendor/WebKit/`. User clones manually (clone takes
 *   10+ min — too slow for the build system to do). We cmake it like any
 *   other dep. Headers land in the BUILD dir (generated during configure),
 *   which is why `provides.includes` returns absolute paths.
 *
 * ## Implementation notes
 *
 * - Build dir is `buildDir/deps/webkit/` (generic path), NOT CMake's
 *   `vendor/WebKit/WebKitBuild/`. Better: consistent, cleaned by `rm -rf
 *   build/`, separate per-profile.
 *
 * - Flags: WebKit's own cmake machinery sets compiler flags. We set
 *   `CMAKE_C_FLAGS: ""` in our args to clear the global dep flags
 *   (which would otherwise conflict). Dep args go LAST in source.ts,
 *   so they override.
 *
 * - Windows local mode: ICU built from source via preBuild hook
 *   (build-icu.ps1 → msbuild) before cmake configure. Output goes in
 *   the per-profile build dir, not shared vendor/WebKit/WebKitBuild/icu/
 *   like the old cmake — avoids debug/release mixing.
 */

import { resolve } from "node:path";
import type { Config } from "../config.ts";
import { slash } from "../shell.ts";
import { type Dependency, type NestedCmakeBuild, type Source, depBuildDir, depSourceDir } from "../source.ts";

// ───────────────────────────────────────────────────────────────────────────
// Prebuilt URL computation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tarball suffix encoding ABI-affecting flags. MUST match the WebKit
 * release workflow naming in oven-sh/WebKit's CI.
 */
function prebuiltSuffix(cfg: Config): string {
  let s = "";
  if (cfg.linux && cfg.abi === "musl") s += "-musl";
  // Baseline WebKit artifacts (-march=nehalem, /arch:SSE2 ICU) exist for
  // Linux amd64 (glibc + musl) and Windows amd64. No baseline variant for
  // arm64 or macOS. Suffix order matches the release asset names:
  // bun-webkit-linux-amd64-musl-baseline-lto.tar.gz
  if (cfg.baseline && cfg.x64) s += "-baseline";
  if (cfg.debug) s += "-debug";
  else if (cfg.lto) s += "-lto";
  if (cfg.asan) s += "-asan";
  return s;
}

function prebuiltUrl(cfg: Config): string {
  const os = cfg.windows ? "windows" : cfg.darwin ? "macos" : "linux";
  const arch = cfg.arm64 ? "arm64" : "amd64";
  const name = `bun-webkit-${os}-${arch}${prebuiltSuffix(cfg)}`;
  const version = cfg.webkitVersion;
  const tag = version.startsWith("autobuild-") ? version : `autobuild-${version}`;
  return `https://github.com/oven-sh/WebKit/releases/download/${tag}/${name}.tar.gz`;
}

/**
 * Prebuilt extraction dir. Suffix in the key so switching debug ↔ release
 * doesn't reuse a wrong-ABI extraction.
 */
function prebuiltDestDir(cfg: Config): string {
  const version16 = cfg.webkitVersion.slice(0, 16);
  return resolve(cfg.cacheDir, `webkit-${version16}${prebuiltSuffix(cfg)}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Lib paths — relative to destDir (prebuilt) or buildDir (local)
// ───────────────────────────────────────────────────────────────────────────

/** Build a lib path under the WebKit install's lib/ dir. */
function wkLib(cfg: Config, name: string): string {
  return `lib/${cfg.libPrefix}${name}${cfg.libSuffix}`;
}

/**
 * Core libs (WTF, JSC) — always present.
 */
function coreLibs(cfg: Config): string[] {
  return [wkLib(cfg, "WTF"), wkLib(cfg, "JavaScriptCore")];
}

function bmallocLib(cfg: Config): string {
  return wkLib(cfg, "bmalloc");
}

/**
 * ICU libs — prebuilt bundles them on linux/windows. macOS uses system ICU.
 * Local mode: system ICU on posix (linked via -licu* in bun.ts); built from
 * source on Windows (see icuDir/icuLibs).
 */
function prebuiltIcuLibs(cfg: Config): string[] {
  if (cfg.windows) {
    const d = cfg.debug ? "d" : "";
    return [`lib/sicudt${d}.lib`, `lib/sicuin${d}.lib`, `lib/sicuuc${d}.lib`];
  }
  if (cfg.linux) {
    return ["lib/libicudata.a", "lib/libicui18n.a", "lib/libicuuc.a"];
  }
  return []; // darwin: system ICU
}

// ───────────────────────────────────────────────────────────────────────────
// Windows local mode: ICU built from source via build-icu.ps1
//
// No system ICU on Windows. The script (in vendor/WebKit/) downloads ICU
// source, patches .vcxproj files for static+/MT, runs msbuild. Output goes
// under the WebKit build dir (NOT vendor/WebKit/WebKitBuild/icu/ like the
// old cmake did) — per-profile, so debug/release don't conflate.
// ───────────────────────────────────────────────────────────────────────────

/** Where build-icu.ps1 writes its output. Per-profile via buildDir. */
function icuDir(cfg: Config): string {
  return resolve(depBuildDir(cfg, "WebKit"), "icu");
}

/**
 * Libs produced by build-icu.ps1. Names are from the script's output
 * (sicudt.lib, icuin.lib, icuuc.lib) — no `d` suffix needed since the
 * per-profile dir already isolates debug/release.
 */
function localIcuLibs(cfg: Config): string[] {
  const dir = icuDir(cfg);
  return [resolve(dir, "lib", "sicudt.lib"), resolve(dir, "lib", "icuin.lib"), resolve(dir, "lib", "icuuc.lib")];
}

// ───────────────────────────────────────────────────────────────────────────
// The Dependency
// ───────────────────────────────────────────────────────────────────────────

export const webkit: Dependency = {
  name: "WebKit",
  versionMacro: "WEBKIT",

  source: cfg => {
    if (cfg.webkit === "prebuilt") {
      const src: Source = {
        kind: "prebuilt",
        url: prebuiltUrl(cfg),
        // Identity = version + suffix. Suffix ensures profile switches
        // (debug ↔ release, asan toggle) trigger re-download. Without it,
        // same version stamp would skip, leaving the wrong ABI on disk.
        identity: `${cfg.webkitVersion}${prebuiltSuffix(cfg)}`,
        destDir: prebuiltDestDir(cfg),
      };
      // macOS: bundled ICU headers conflict with system ICU.
      if (cfg.darwin) {
        src.rmAfterExtract = ["include/unicode"];
      }
      return src;
    }

    // Local: user clones vendor/WebKit/ manually (clone takes 10+ min — the
    // one thing the build system doesn't automate). Once cloned, we cmake it
    // like any other dep. resolveDep()'s local-mode assert gives a clear
    // "clone it yourself" error if missing.
    return { kind: "local" };
  },

  build: cfg => {
    if (cfg.webkit === "prebuilt") {
      return { kind: "none" };
    }

    // Local: nested cmake, target=jsc.
    //
    // CMAKE_C_FLAGS/CMAKE_CXX_FLAGS set to empty: clears the global dep
    // flags source.ts would otherwise pass. WebKit's cmake sets its own
    // -O/-march/etc.; ours would conflict. Dep args go LAST so they override.
    //
    // Windows: ICU built from source via preBuild before cmake configure.
    // WebKit's cmake finds it via ICU_ROOT. On posix, system ICU is used
    // (macOS: Homebrew headers + system libs; Linux: libicu-dev) — cmake
    // auto-detects.
    const args: Record<string, string> = {
      CMAKE_C_FLAGS: "",
      CMAKE_CXX_FLAGS: "",
      PORT: "JSCOnly",
      ENABLE_STATIC_JSC: "ON",
      USE_THIN_ARCHIVES: "OFF",
      ENABLE_FTL_JIT: "ON",
      CMAKE_EXPORT_COMPILE_COMMANDS: "ON",
      USE_BUN_JSC_ADDITIONS: "ON",
      USE_BUN_EVENT_LOOP: "ON",
      ENABLE_BUN_SKIP_FAILING_ASSERTIONS: "ON",
      ALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS: "ON",
      ENABLE_REMOTE_INSPECTOR: "ON",
      ENABLE_MEDIA_SOURCE: "OFF",
      ENABLE_MEDIA_STREAM: "OFF",
      ENABLE_WEB_RTC: "OFF",
      ...(cfg.asan ? { ENABLE_SANITIZERS: "address" } : {}),
    };

    const spec: NestedCmakeBuild = { kind: "nested-cmake", targets: ["jsc"], args };

    if (cfg.windows) {
      const icu = icuDir(cfg);
      const srcDir = depSourceDir(cfg, "WebKit");
      // slash(): cmake -D values — see shell.ts.
      args.ICU_ROOT = slash(icu);
      args.ICU_LIBRARY = slash(resolve(icu, "lib"));
      args.ICU_INCLUDE_DIR = slash(resolve(icu, "include"));
      // U_STATIC_IMPLEMENTATION: ICU headers default to dllimport; we
      // link statically. Matches what the old cmake's SetupWebKit did.
      args.CMAKE_C_FLAGS = "/DU_STATIC_IMPLEMENTATION";
      args.CMAKE_CXX_FLAGS = "/DU_STATIC_IMPLEMENTATION /clang:-fno-c++-static-destructors";
      // Static CRT to match bun + all other deps (we build everything
      // with /MTd or /MT). Without this, cmake defaults to /MDd →
      // RuntimeLibrary mismatch at link.
      args.CMAKE_MSVC_RUNTIME_LIBRARY = cfg.debug ? "MultiThreadedDebug" : "MultiThreaded";
      spec.preBuild = {
        command: [
          "powershell",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(srcDir, "build-icu.ps1"),
          "-Platform",
          cfg.x64 ? "x64" : "ARM64",
          "-BuildType",
          cfg.debug ? "Debug" : "Release",
          "-OutputDir",
          icu,
        ],
        cwd: srcDir,
        outputs: localIcuLibs(cfg),
      };
    }

    return spec;
  },

  provides: cfg => {
    if (cfg.webkit === "prebuilt") {
      // Paths relative to prebuilt destDir — emitPrebuilt resolves them.
      //
      // bmalloc: some historical prebuilts rolled it into JSC. Current
      // versions ship it separately on all platforms. Listed here so
      // emitPrebuilt declares it as an output — ninja knows fetch creates
      // it. If a future version drops libbmalloc.a, you'll get a clear
      // "file not found" at link time (not silent omission + cryptic
      // undefined symbols).
      const libs = [...coreLibs(cfg), ...prebuiltIcuLibs(cfg), bmallocLib(cfg)];

      const includes = ["include"];
      // Linux/windows: ICU headers under wtf/unicode. macOS: deleted by
      // postExtract.
      if (!cfg.darwin) includes.push("include/wtf/unicode");

      return { libs, includes };
    }

    // Local: paths relative to BUILD dir (headers generated during build).
    // includes uses ABSOLUTE paths via depBuildDir() — source.ts's
    // resolve-against-srcDir would point at vendor/WebKit/ (wrong).
    const buildDir = depBuildDir(cfg, "WebKit");

    // Lib paths: emitNestedCmake resolves these relative to the build dir's
    // libSubdir — we set none, so it's buildDir root. But WebKit's libs are
    // in lib/. So include the lib/ prefix.
    //
    // Windows ICU libs are NOT listed here — they're preBuild.outputs,
    // which source.ts appends to the resolved libs automatically. Listing
    // them here would make dep_build also claim to produce them (dup error).
    // Posix uses system ICU (linked via -licu* in bun.ts).
    const libs = [...coreLibs(cfg), bmallocLib(cfg)];

    const includes = [
      // ABSOLUTE — resolved here because they're in the build dir, not src.
      buildDir,
      resolve(buildDir, "JavaScriptCore", "Headers"),
      resolve(buildDir, "JavaScriptCore", "Headers", "JavaScriptCore"),
      resolve(buildDir, "JavaScriptCore", "PrivateHeaders"),
      resolve(buildDir, "bmalloc", "Headers"),
      resolve(buildDir, "WTF", "Headers"),
      resolve(buildDir, "JavaScriptCore", "PrivateHeaders", "JavaScriptCore"),
    ];
    // Windows: ICU headers from preBuild output.
    if (cfg.windows) includes.push(resolve(icuDir(cfg), "include"));

    return { libs, includes };
  },
};
