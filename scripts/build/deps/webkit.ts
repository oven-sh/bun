/**
 * WebKit commit — determines prebuilt download URL + what to checkout
 * for local mode. Override via `--webkit-version=<hash>` to test a branch.
 * From https://github.com/oven-sh/WebKit releases.
 */
export const WEBKIT_VERSION = "f5f6c3f654bd19baf14a849160c704b12d198f87";

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
 * **local**: Source at `vendor/WebKit/`, or `$BUN_WEBKIT_PATH` if set. User
 *   clones manually (clone takes 10+ min — too slow for the build system
 *   to do). Set `BUN_WEBKIT_PATH` to share one clone across worktrees. We
 *   cmake it like any other dep. Headers land in the BUILD dir (generated
 *   during configure), which is why `provides.includes` returns absolute
 *   paths.
 *
 * ## Implementation notes
 *
 * - Build dir is `buildDir/deps/webkit/` (generic path), NOT CMake's
 *   `vendor/WebKit/WebKitBuild/`. Better: consistent, cleaned by `rm -rf
 *   build/`, separate per-profile.
 *
 * - Flags: WebKit's own cmake machinery sets -O/-g/sanitizer flags. We
 *   override `CMAKE_C_FLAGS` to drop the global dep flags (which would
 *   conflict) but DO forward -march/-mcpu + LTO/PGO, which WebKit never
 *   sets. Dep args go LAST in source.ts, so they override.
 *
 * - Windows local mode: ICU built from source via preBuild hook
 *   (build-icu.ps1 → msbuild) before cmake configure. Output goes in
 *   the per-profile build dir, not shared vendor/WebKit/WebKitBuild/icu/
 *   like the old cmake — avoids debug/release mixing.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Config } from "../config.ts";
import { computeCpuTargetFlags } from "../flags.ts";
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
  if (cfg.linux && cfg.abi === "android") s += "-android";
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

/**
 * WebKit source dir for local mode. Defaults to vendor/WebKit; override via
 * $BUN_WEBKIT_PATH to share one clone across worktrees.
 */
function webkitSrcDir(cfg: Config): string {
  const env = process.env.BUN_WEBKIT_PATH;
  if (!env) return depSourceDir(cfg, "WebKit");
  // Shells don't expand ~ inside quotes; handle it here so a quoted export works.
  if (env === "~" || env.startsWith("~/") || env.startsWith("~\\")) return join(homedir(), env.slice(1));
  // Anchor relative paths to the repo root so ninja's regen rule (which runs
  // from buildDir) resolves the same path as the initial configure.
  return resolve(cfg.cwd, env);
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

    // Local: user clones manually (clone takes 10+ min — the one thing the
    // build system doesn't automate). Once cloned, we cmake it like any
    // other dep. resolveDep()'s local-mode assert gives a clear "clone it
    // yourself" error if missing.
    const env = process.env.BUN_WEBKIT_PATH;
    return {
      kind: "local",
      path: webkitSrcDir(cfg),
      hint: env
        ? `$BUN_WEBKIT_PATH is set to '${env}' but that path does not contain a WebKit checkout`
        : "Clone oven-sh/WebKit to vendor/WebKit/, or set $BUN_WEBKIT_PATH to an existing clone (useful for worktrees)",
    };
  },

  build: cfg => {
    if (cfg.webkit === "prebuilt") {
      return { kind: "none" };
    }

    // Local: nested cmake, target=jsc.
    //
    // CMAKE_C_FLAGS/CMAKE_CXX_FLAGS: overrides the global dep flags source.ts
    // would otherwise pass — WebKit's cmake sets its own -O/-g/sanitizer
    // flags; ours would conflict. Dep args go LAST so they override. We DO
    // forward:
    //   - CPU target (-march/-mcpu): WebKit never sets this — without it,
    //     local builds target generic x86-64 while bun + prebuilt WebKit
    //     target haswell/nehalem.
    //   - LTO/PGO: WebKit's cmake doesn't set those itself.
    //
    // Windows: ICU built from source via preBuild before cmake configure.
    // WebKit's cmake finds it via ICU_ROOT. On posix, system ICU is used
    // (macOS: Homebrew headers + system libs; Linux: libicu-dev) — cmake
    // auto-detects.
    const optFlags: string[] = computeCpuTargetFlags(cfg);
    if (cfg.lto) optFlags.push("-flto=full");
    if (cfg.pgoGenerate) optFlags.push(`-fprofile-generate=${cfg.pgoGenerate}`);
    if (cfg.pgoUse) {
      optFlags.push(
        `-fprofile-use=${cfg.pgoUse}`,
        "-Wno-profile-instr-out-of-date",
        "-Wno-profile-instr-unprofiled",
        "-Wno-backend-plugin",
      );
    }
    // Android local mode: WebKit overrides CMAKE_{C,CXX}_FLAGS (dropping the
    // global --target/--sysroot we'd normally inject), so we hand CMake the
    // NDK directly instead. CMAKE_SYSTEM_NAME=Android puts CMake into
    // cross-compile mode (CMAKE_CROSSCOMPILING=ON, no try_run) and lets it
    // derive sysroot/libc++ from CMAKE_ANDROID_NDK. We still set
    // CMAKE_{C,CXX}_COMPILER (in source.ts) so the host clang is used
    // rather than the NDK's bundled one.
    if (cfg.abi === "android") {
      optFlags.push(`--target=${cfg.crossTarget!}`, `--sysroot=${cfg.sysroot!}`);
    }
    const optFlagStr = optFlags.join(" ");
    const args: Record<string, string> = {
      CMAKE_C_FLAGS: optFlagStr,
      CMAKE_CXX_FLAGS: optFlagStr,
      ...(cfg.abi === "android"
        ? {
            CMAKE_SYSTEM_NAME: "Android",
            CMAKE_SYSTEM_VERSION: String(cfg.androidApiLevel!),
            CMAKE_ANDROID_NDK: cfg.androidNdk!,
            CMAKE_ANDROID_ARCH_ABI: cfg.arm64 ? "arm64-v8a" : "x86_64",
            CMAKE_ANDROID_STL_TYPE: "c++_static",
            ENABLE_API_TESTS: "OFF",
          }
        : {}),
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

    const spec: NestedCmakeBuild = {
      kind: "nested-cmake",
      targets: ["jsc"],
      args,
      // Release local WebKit keeps debug info so JSC crashes symbolicate.
      // LTO stays plain Release (debug info + LTO bloats significantly).
      buildType: cfg.release && !cfg.lto ? "RelWithDebInfo" : cfg.buildType,
    };

    if (cfg.windows) {
      const icu = icuDir(cfg);
      const srcDir = webkitSrcDir(cfg);
      // slash(): cmake -D values — see shell.ts.
      args.ICU_ROOT = slash(icu);
      args.ICU_LIBRARY = slash(resolve(icu, "lib"));
      args.ICU_INCLUDE_DIR = slash(resolve(icu, "include"));
      // U_STATIC_IMPLEMENTATION: ICU headers default to dllimport; we
      // link statically. Matches what the old cmake's SetupWebKit did.
      args.CMAKE_C_FLAGS = `/DU_STATIC_IMPLEMENTATION ${optFlagStr}`.trim();
      args.CMAKE_CXX_FLAGS = `/DU_STATIC_IMPLEMENTATION /clang:-fno-c++-static-destructors ${optFlagStr}`.trim();
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
