/**
 * Build configuration.
 *
 * One flat struct. All derived booleans computed once in `resolveConfig()`,
 * passed everywhere. No `if(ENABLE_X)` depending on `if(CI)` depending on
 * `if(RELEASE)` — the chain is resolved here and the result is a plain value.
 */

import { existsSync, readFileSync } from "node:fs";
import { arch as hostArch, platform as hostPlatform } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { NODEJS_ABI_VERSION, NODEJS_VERSION } from "./deps/nodejs-headers.ts";
import { WEBKIT_VERSION } from "./deps/webkit.ts";
import { BuildError, assert } from "./error.ts";
import { clangTargetArch } from "./tools.ts";
import { ZIG_COMMIT } from "./zig.ts";

export type OS = "linux" | "darwin" | "windows";
export type Arch = "x64" | "aarch64";
export type Abi = "gnu" | "musl";
export type BuildType = "Debug" | "Release" | "RelWithDebInfo" | "MinSizeRel";
export type BuildMode = "full" | "cpp-only" | "zig-only" | "link-only";
export type WebKitMode = "prebuilt" | "local";

/**
 * Host platform — what's running the build. Distinguish from target
 * (Config.os/arch/windows) which is what we're building FOR.
 *
 * Host vs target matters for zig-only cross-compile: a linux CI box
 * can cross-compile bun-zig.o for darwin/windows. Target determines
 * zig's triple and compile flags; host determines shell syntax (cmd
 * vs sh), quoting, and tool executable suffixes.
 *
 * For all other modes (full, cpp-only, link-only), host == target
 * since we don't cross-compile C++.
 */
export interface Host {
  os: OS;
  arch: Arch;
}

/**
 * Pinned version defaults. Each lives at the top of its own file
 * (deps/webkit.ts, zig.ts, deps/nodejs-headers.ts) — look there to bump.
 * Overridable via PartialConfig for testing (e.g. trying a WebKit branch).
 */
const versionDefaults = {
  nodejsVersion: NODEJS_VERSION,
  nodejsAbiVersion: NODEJS_ABI_VERSION,
  zigCommit: ZIG_COMMIT,
  webkitVersion: WEBKIT_VERSION,
};

/**
 * The full resolved build configuration. Every field is concrete — no
 * undefined-because-it-depends-on-something-else. This is the single source
 * of truth passed to every build function.
 */
export interface Config {
  // ─── Target platform ───
  os: OS;
  arch: Arch;
  /** Linux-only. undefined on darwin/windows. */
  abi: Abi | undefined;

  // ─── Derived platform booleans (computed from os/arch) ───
  linux: boolean;
  darwin: boolean;
  windows: boolean;
  /** linux || darwin */
  unix: boolean;
  x64: boolean;
  arm64: boolean;

  /**
   * What's running the build. Differs from os/arch/windows (target) in
   * zig-only cross-compile. Use for: shell syntax in rule commands,
   * quoteArgs(), tool executable suffixes. See Host type docs.
   */
  host: Host;

  // ─── Platform file conventions ───
  // Centralized so a new target (or a forgotten .exe) is one edit away.
  /** ".exe" on Windows, "" elsewhere. */
  exeSuffix: string;
  /** ".obj" on Windows, ".o" elsewhere. */
  objSuffix: string;
  /** "" on Windows, "lib" elsewhere. */
  libPrefix: string;
  /** ".lib" on Windows, ".a" elsewhere. */
  libSuffix: string;

  // ─── Build configuration ───
  buildType: BuildType;
  debug: boolean;
  release: boolean;
  mode: BuildMode;

  // ─── Features (all explicit booleans) ───
  lto: boolean;
  asan: boolean;
  zigAsan: boolean;
  assertions: boolean;
  logs: boolean;
  /** x64-only: target nehalem (no AVX) instead of haswell. */
  baseline: boolean;
  canary: boolean;
  /** MinSizeRel → optimize for size. */
  smol: boolean;
  staticSqlite: boolean;
  staticLibatomic: boolean;
  tinycc: boolean;
  valgrind: boolean;
  fuzzilli: boolean;

  // ─── Environment ───
  ci: boolean;
  buildkite: boolean;

  // ─── Dependency modes ───
  webkit: WebKitMode;

  // ─── Paths (all absolute) ───
  /** Repository root. */
  cwd: string;
  /** Build output directory, e.g. /path/to/bun/build/debug/. */
  buildDir: string;
  /** Generated code output, e.g. buildDir/codegen/. */
  codegenDir: string;
  /** Persistent cache for dep tarballs and builds. */
  cacheDir: string;
  /** Vendored dependencies (gitignored). */
  vendorDir: string;

  // ─── Toolchain (resolved absolute paths) ───
  cc: string;
  cxx: string;
  ar: string;
  /** llvm-ranlib. undefined on windows (llvm-lib indexes itself). */
  ranlib: string | undefined;
  /** ld.lld on linux, lld-link on windows. May be empty on darwin (clang invokes ld). */
  ld: string;
  strip: string;
  /** darwin-only. */
  dsymutil: string | undefined;
  zig: string;
  /** Self-host bun for codegen. */
  bun: string;
  esbuild: string;
  /** Optional — compiler launcher prefix. */
  ccache: string | undefined;
  /** cmake executable. Required for nested dep builds. */
  cmake: string;
  /** cargo executable. undefined when no rust toolchain is available. */
  cargo: string | undefined;
  /** CARGO_HOME — passed to cargo invocations for reproducibility. */
  cargoHome: string | undefined;
  /** RUSTUP_HOME — passed to cargo invocations for reproducibility. */
  rustupHome: string | undefined;
  /** Windows: MSVC link.exe path (to avoid Git's /usr/bin/link shadowing). */
  msvcLinker: string | undefined;
  /** Windows: llvm-rc for nested cmake (CMAKE_RC_COMPILER). */
  rc: string | undefined;
  /** Windows: llvm-mt for nested cmake (CMAKE_MT). May be absent in some LLVM distros. */
  mt: string | undefined;

  // ─── macOS SDK (darwin only, undefined elsewhere) ───
  /** e.g. "13.0". Passed to deps as -DCMAKE_OSX_DEPLOYMENT_TARGET. */
  osxDeploymentTarget: string | undefined;
  /** SDK path from `xcrun --show-sdk-path`. Passed to deps as -DCMAKE_OSX_SYSROOT. */
  osxSysroot: string | undefined;

  // ─── Versioning ───
  /** Bun's own version (from package.json). */
  version: string;
  /** Git commit of the bun checkout — feeds into zig's -Dsha. */
  revision: string;
  canaryRevision: string;
  /** Node.js compat version. Default in versions.ts; override to test a bump. */
  nodejsVersion: string;
  nodejsAbiVersion: string;
  /** Zig compiler commit. Default in versions.ts; override to test a new compiler. */
  zigCommit: string;
  /** WebKit commit. Default in versions.ts; override to test a WebKit branch. */
  webkitVersion: string;
}

/**
 * Partial config — what profiles and CLI flags provide.
 * Resolution fills in the rest.
 */
export interface PartialConfig {
  os?: OS;
  arch?: Arch;
  abi?: Abi;
  buildType?: BuildType;
  mode?: BuildMode;
  lto?: boolean;
  asan?: boolean;
  zigAsan?: boolean;
  assertions?: boolean;
  logs?: boolean;
  baseline?: boolean;
  canary?: boolean;
  staticSqlite?: boolean;
  staticLibatomic?: boolean;
  tinycc?: boolean;
  valgrind?: boolean;
  fuzzilli?: boolean;
  ci?: boolean;
  buildkite?: boolean;
  webkit?: WebKitMode;
  buildDir?: string;
  cacheDir?: string;
  // Version pins (defaults in versions.ts).
  nodejsVersion?: string;
  nodejsAbiVersion?: string;
  zigCommit?: string;
  webkitVersion?: string;
}

/**
 * Resolved toolchain — found by tool discovery, passed in separately so
 * tests can mock it out.
 */
export interface Toolchain {
  cc: string;
  cxx: string;
  ar: string;
  ranlib: string | undefined;
  ld: string;
  strip: string;
  dsymutil: string | undefined;
  zig: string;
  bun: string;
  esbuild: string;
  ccache: string | undefined;
  cmake: string;
  /** Cargo executable. Required only if a rust dep (lolhtml) is being built. */
  cargo: string | undefined;
  /** CARGO_HOME. Set alongside cargo; undefined when cargo is unavailable. */
  cargoHome: string | undefined;
  /** RUSTUP_HOME. Set alongside cargo; undefined when cargo is unavailable. */
  rustupHome: string | undefined;
  /**
   * Windows only: absolute path to MSVC's link.exe. Set as the cargo linker
   * via CARGO_TARGET_<triple>_LINKER to prevent Git Bash's /usr/bin/link
   * (the GNU hard-link utility) from shadowing the real linker in PATH.
   */
  msvcLinker: string | undefined;
  /**
   * Windows only: llvm-rc (resource compiler). Passed to nested cmake
   * as CMAKE_RC_COMPILER. cmake's own detection usually finds it, but
   * that depends on PATH and cmake version — explicit is safer.
   */
  rc: string | undefined;
  /**
   * Windows only: llvm-mt (manifest tool). Passed to nested cmake as
   * CMAKE_MT. Optional — some LLVM distributions don't ship llvm-mt;
   * when absent, cmake's STATIC_LIBRARY try-compile mode (set in
   * source.ts) sidesteps the need.
   */
  mt: string | undefined;
}

/**
 * Host platform detection. Only used for picking defaults.
 */
export function detectHost(): Host {
  const plat = hostPlatform();
  const os: OS =
    plat === "linux"
      ? "linux"
      : plat === "darwin"
        ? "darwin"
        : plat === "win32"
          ? "windows"
          : (() => {
              throw new BuildError(`Unsupported host platform: ${plat}`, {
                hint: "Bun builds on linux, darwin, or windows",
              });
            })();

  const a = hostArch();
  const arch: Arch =
    a === "x64"
      ? "x64"
      : a === "arm64"
        ? "aarch64"
        : (() => {
            throw new BuildError(`Unsupported host architecture: ${a}`, { hint: "Bun builds on x64 or arm64" });
          })();

  return { os, arch };
}

/**
 * Detect linux ABI (gnu vs musl) by checking for /etc/alpine-release.
 */
export function detectLinuxAbi(): Abi {
  return existsSync("/etc/alpine-release") ? "musl" : "gnu";
}

/**
 * Resolve a PartialConfig into a full Config.
 *
 * This is where all the "X defaults to Y unless Z" chains get resolved into
 * concrete values. After this runs, everything downstream sees plain booleans.
 */
export function resolveConfig(partial: PartialConfig, toolchain: Toolchain): Config {
  const host = detectHost();

  // ─── Target platform ───
  const os = partial.os ?? host.os;
  // Windows: process.arch can be wrong under emulation (x64 bun on arm64
  // hardware). Ask the compiler what it targets — CMake does the same in
  // project() to set CMAKE_SYSTEM_PROCESSOR. The found clang's default
  // target is what we actually build for.
  const compilerArch = os === "windows" ? clangTargetArch(toolchain.cc) : undefined;
  const arch = partial.arch ?? compilerArch ?? host.arch;
  const abi: Abi | undefined = os === "linux" ? (partial.abi ?? detectLinuxAbi()) : undefined;

  const linux = os === "linux";
  const darwin = os === "darwin";
  const windows = os === "windows";
  const unix = linux || darwin;
  const x64 = arch === "x64";
  const arm64 = arch === "aarch64";

  // Platform file conventions — MSVC style on Windows, Unix everywhere else.
  const exeSuffix = windows ? ".exe" : "";
  const objSuffix = windows ? ".obj" : ".o";
  const libPrefix = windows ? "" : "lib";
  const libSuffix = windows ? ".lib" : ".a";

  // ─── Build type ───
  const buildType = partial.buildType ?? "Debug";
  const debug = buildType === "Debug";
  const release = buildType === "Release" || buildType === "RelWithDebInfo" || buildType === "MinSizeRel";
  const smol = buildType === "MinSizeRel";

  // ─── Environment ───
  // Explicit (not auto-detected from env) — matches CMake's optionx(CI DEFAULT OFF).
  // The ci-* profiles set these. Affects build semantics: LTO default, PCH
  // skip, macOS min SDK. Log-group/annotation decisions use the runtime env
  // detection in ci.ts instead, so running a non-CI profile on a CI machine
  // still gets collapsible logs but not CI build flags.
  const ci = partial.ci ?? false;
  const buildkite = partial.buildkite ?? false;

  // ─── Features ───
  // Each is resolved exactly once here.

  // ASAN: default on for debug builds on arm64 macOS or linux
  const asanDefault = debug && ((darwin && arm64) || linux);
  const asan = partial.asan ?? asanDefault;

  // Zig ASAN follows ASAN unless explicitly overridden
  const zigAsan = partial.zigAsan ?? asan;

  // Assertions: default on in debug OR asan. ASAN coupling is ABI-critical:
  // the -asan WebKit prebuilt is built with ASSERT_ENABLED=1, which gates
  // struct fields (RefCountDebugger etc). If bun's C++ isn't also compiled
  // with ASSERT_ENABLED=1, the struct layouts mismatch → crashes. CMake's
  // build:asan always set ENABLE_ASSERTIONS=ON for this reason.
  const assertions = partial.assertions ?? (debug || asan);

  // LTO: default on only for CI release linux non-asan non-assertions
  const ltoDefault = release && linux && ci && !assertions && !asan;
  let lto = partial.lto ?? ltoDefault;
  // ASAN and LTO don't mix — ASAN wins (silently, no warn — config is explicit)
  if (asan && lto) {
    lto = false;
  }

  // Logs: on by default in debug non-test
  const logs = partial.logs ?? debug;

  const baseline = partial.baseline ?? false;
  const canary = partial.canary ?? true;
  const canaryRevision = canary ? "1" : "0";

  // Static SQLite: off on Apple (uses system), on elsewhere
  const staticSqlite = partial.staticSqlite ?? !darwin;

  // Static libatomic: on by default. Arch/Manjaro don't ship libatomic.a —
  // those users pass --static-libatomic=off. Not auto-detected: the link
  // failure is loud ("cannot find -l:libatomic.a") and the fix is obvious.
  const staticLibatomic = partial.staticLibatomic ?? true;

  // TinyCC: off on Windows ARM64 (not supported), on elsewhere
  const tinycc = partial.tinycc ?? !(windows && arm64);

  const valgrind = partial.valgrind ?? false;
  const fuzzilli = partial.fuzzilli ?? false;

  // ─── Paths ───
  const cwd = findRepoRoot();
  const defaultBuildDirName = computeBuildDirName({ debug, release, asan, assertions });
  const buildDir =
    partial.buildDir !== undefined
      ? isAbsolute(partial.buildDir)
        ? partial.buildDir
        : resolve(cwd, partial.buildDir)
      : resolve(cwd, "build", defaultBuildDirName);
  const codegenDir = resolve(buildDir, "codegen");
  const cacheDir =
    partial.cacheDir !== undefined
      ? isAbsolute(partial.cacheDir)
        ? partial.cacheDir
        : resolve(cwd, partial.cacheDir)
      : resolve(buildDir, "cache");
  const vendorDir = resolve(cwd, "vendor");

  // ─── Validation ───
  assert(!baseline || x64, "baseline=true requires arch=x64 (baseline disables AVX which is x64-only)");
  assert(!valgrind || linux, "valgrind=true requires os=linux");
  assert(!(asan && valgrind), "Cannot enable both asan and valgrind simultaneously");
  assert(os !== "linux" || abi !== undefined, "Linux builds require an abi (gnu or musl)");

  // ─── Versioning ───
  const pkgJsonPath = resolve(cwd, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version: string };
  const version = pkgJson.version;
  const revision = getGitRevision(cwd);

  // Defaults from versions.ts. Override via --webkit-version=<hash> etc.
  // to test a branch before bumping the pinned default.
  const nodejsVersion = partial.nodejsVersion ?? versionDefaults.nodejsVersion;
  const nodejsAbiVersion = partial.nodejsAbiVersion ?? versionDefaults.nodejsAbiVersion;
  const zigCommit = partial.zigCommit ?? versionDefaults.zigCommit;
  const webkitVersion = partial.webkitVersion ?? versionDefaults.webkitVersion;

  // ─── macOS SDK ───
  // Must be passed to nested cmake builds or they'll pick the wrong SDK.
  // Requires BOTH host and target to be darwin — xcode only exists on
  // macOS, and cross-compiling C++/deps to darwin isn't supported (only
  // zig cross-compiles, and zig brings its own SDKs).
  let osxDeploymentTarget: string | undefined;
  let osxSysroot: string | undefined;
  if (darwin && host.os === "darwin") {
    ({ osxDeploymentTarget, osxSysroot } = detectMacosSdk(ci));
  }

  return {
    os,
    arch,
    abi,
    linux,
    darwin,
    windows,
    unix,
    x64,
    arm64,
    host,
    exeSuffix,
    objSuffix,
    libPrefix,
    libSuffix,
    buildType,
    debug,
    release,
    mode: partial.mode ?? "full",
    lto,
    asan,
    zigAsan,
    assertions,
    logs,
    baseline,
    canary,
    smol,
    staticSqlite,
    staticLibatomic,
    tinycc,
    valgrind,
    fuzzilli,
    ci,
    buildkite,
    webkit: partial.webkit ?? "prebuilt",
    cwd,
    buildDir,
    codegenDir,
    cacheDir,
    vendorDir,
    cc: toolchain.cc,
    cxx: toolchain.cxx,
    ar: toolchain.ar,
    ranlib: toolchain.ranlib,
    ld: toolchain.ld,
    strip: toolchain.strip,
    dsymutil: toolchain.dsymutil,
    zig: toolchain.zig,
    bun: toolchain.bun,
    esbuild: toolchain.esbuild,
    ccache: toolchain.ccache,
    cmake: toolchain.cmake,
    cargo: toolchain.cargo,
    cargoHome: toolchain.cargoHome,
    rustupHome: toolchain.rustupHome,
    msvcLinker: toolchain.msvcLinker,
    rc: toolchain.rc,
    mt: toolchain.mt,
    osxDeploymentTarget,
    osxSysroot,
    version,
    revision,
    nodejsVersion,
    nodejsAbiVersion,
    canaryRevision,
    zigCommit,
    webkitVersion,
  };
}

/** Minimum macOS SDK version we support. */
const MIN_OSX_DEPLOYMENT_TARGET = "13.0";

/**
 * Detect macOS SDK paths.
 *
 * - CI: always target the minimum (reproducible builds).
 * - Local: target the installed SDK's major version (avoids linker warnings
 *   about object files built for newer macOS than target).
 *
 * Fast path: `xcode-select -p` (~5ms) gives the developer dir; from there
 * we construct the SDK path and parse the version from the resolved
 * symlink. Avoids `xcrun` (~100ms × 2 spawns). Falls back to xcrun only if
 * the constructed path doesn't exist (exotic installs).
 */
function detectMacosSdk(ci: boolean): { osxDeploymentTarget: string; osxSysroot: string } {
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  const { existsSync, realpathSync } = require("node:fs") as typeof import("node:fs");

  // xcode-select -p prints the active developer dir (respects
  // `xcode-select --switch` and DEVELOPER_DIR). It's a tiny C binary —
  // fast enough to be negligible, unlike xcrun which does a bunch of
  // environment discovery.
  let devDir: string;
  try {
    devDir = (process.env.DEVELOPER_DIR ?? execSync("xcode-select -p", { encoding: "utf8" })).trim();
  } catch (cause) {
    throw new BuildError("xcode-select failed — command line tools not installed?", {
      hint: "Run: xcode-select --install",
      cause,
    });
  }

  // For full Xcode the dev dir is ".../Developer"; for CLT it's
  // "/Library/Developer/CommandLineTools". SDK layout differs:
  //   Xcode: <dev>/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk
  //   CLT:   <dev>/SDKs/MacOSX.sdk
  //
  // Return the SYMLINK path as sysroot (matches what xcrun returns, and
  // what ends up in build.ninja — so swapping SDKs doesn't cause a
  // spurious full rebuild). But follow the link to PARSE the version
  // from the real basename (e.g. MacOSX14.2.sdk → "14").
  const candidates = [`${devDir}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk`, `${devDir}/SDKs/MacOSX.sdk`];

  let osxSysroot: string | undefined;
  let sdkVersionFromPath: string | undefined;
  for (const path of candidates) {
    if (existsSync(path)) {
      osxSysroot = path; // symlink — matches xcrun's output
      const resolved = realpathSync(path);
      const m = resolved.match(/MacOSX(\d+)(?:\.\d+)*\.sdk$/);
      if (m) sdkVersionFromPath = m[1];
      break;
    }
  }

  // Neither layout matched — fall back to xcrun. Rare (custom SDK
  // locations via SDKROOT env or similar).
  if (osxSysroot === undefined) {
    try {
      osxSysroot = execSync("xcrun --sdk macosx --show-sdk-path", { encoding: "utf8" }).trim();
    } catch (cause) {
      throw new BuildError("Failed to find macOS SDK path", {
        hint: "Run: xcode-select --install",
        cause,
      });
    }
  }

  let osxDeploymentTarget: string;
  if (ci) {
    osxDeploymentTarget = MIN_OSX_DEPLOYMENT_TARGET;
  } else if (sdkVersionFromPath !== undefined) {
    osxDeploymentTarget = sdkVersionFromPath;
  } else {
    // Couldn't parse from path (unversioned symlink target?) — ask xcrun.
    let sdkVersion: string;
    try {
      sdkVersion = execSync("xcrun --sdk macosx --show-sdk-version", { encoding: "utf8" }).trim();
    } catch (cause) {
      throw new BuildError("Failed to find macOS SDK version", {
        hint: "Run: xcode-select --install",
        cause,
      });
    }
    const major = sdkVersion.match(/^(\d+)/)?.[1];
    assert(major !== undefined, `Could not parse macOS SDK version: ${sdkVersion}`);
    osxDeploymentTarget = major;
  }

  // Floor at minimum
  if (compareVersionStrings(osxDeploymentTarget, MIN_OSX_DEPLOYMENT_TARGET) < 0) {
    throw new BuildError(
      `macOS SDK ${osxDeploymentTarget} is older than minimum supported ${MIN_OSX_DEPLOYMENT_TARGET}`,
      { hint: "Update Xcode or Xcode Command Line Tools" },
    );
  }

  return { osxDeploymentTarget, osxSysroot };
}

/** Simple X.Y version comparison. Returns -1, 0, 1. */
function compareVersionStrings(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

/**
 * Find the repository root by walking up from cwd looking for package.json
 * with name "bun". Exported so `resolveToolchain()` in configure.ts can
 * resolve paths correctly when invoked from ninja (where cwd = build dir).
 */
export function findRepoRoot(): string {
  let dir = process.cwd();
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "bun") {
          return dir;
        }
      } catch {
        // Invalid JSON, keep walking
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) {
      throw new BuildError("Could not find bun repository root", { hint: "Run this from within the bun repository" });
    }
    dir = parent;
  }
}

/**
 * Get the current git revision (HEAD sha).
 *
 * Uses `git rev-parse` rather than reading .git/HEAD directly — the sha
 * is baked into the binary and surfaces in bug reports, so correctness
 * matters more than the ~20ms spawn. Git's plumbing has edge cases
 * (packed-refs, worktrees, symbolic refs) that rev-parse handles for free.
 */
function getGitRevision(cwd: string): string {
  // CI env first — authoritative and zero-cost.
  const envSha = process.env.BUILDKITE_COMMIT ?? process.env.GITHUB_SHA ?? process.env.GIT_SHA;
  if (envSha !== undefined && envSha.length > 0) {
    return envSha;
  }
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Compute build directory name based on config.
 * Matches the pattern used by package.json scripts.
 */
function computeBuildDirName(c: { debug: boolean; release: boolean; asan: boolean; assertions: boolean }): string {
  if (c.debug) return "debug";
  if (c.asan) return "release-asan";
  if (c.assertions) return "release-assertions";
  return "release";
}

/**
 * Name of the output executable (no suffix).
 *
 * Debug builds: bun-debug. Release with ASAN: bun-asan. Etc.
 * The plain `bun` name (without -profile) only exists post-strip.
 *
 * Lives here (not bun.ts) so flags.ts can use it for linker-map filename
 * without a circular import.
 */
export function bunExeName(cfg: Config): string {
  if (cfg.debug) return "bun-debug";
  // Release variants — suffix encodes which features differ from plain release.
  // First match wins.
  if (cfg.asan && cfg.valgrind) return "bun-asan-valgrind";
  if (cfg.asan) return "bun-asan";
  if (cfg.valgrind) return "bun-valgrind";
  if (cfg.assertions) return "bun-assertions";
  // Plain release: called bun-profile (the stripped one is `bun`).
  return "bun-profile";
}

/**
 * Whether this config produces a stripped `bun` alongside `bun-profile`.
 *
 * Only plain release builds strip — not debug (you want symbols), not
 * asan/valgrind (strip interferes), not assertions (usually debugging).
 */
export function shouldStrip(cfg: Config): boolean {
  return !cfg.debug && !cfg.asan && !cfg.valgrind && !cfg.assertions;
}

// ANSI helpers — no-op when output isn't a TTY (pipe, file, `bd` log).
const useColor = Bun.enableANSIColors && process.stderr.isTTY;
const c = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[39m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[39m` : s),
};

/**
 * Format a config for display (used at configure time).
 * `exe` is the output binary name (e.g. "bun-debug" or "bun-profile → bun (stripped)").
 */
export function formatConfig(cfg: Config, exe: string): string {
  const label = (s: string) => c.dim(s.padEnd(12));
  // Relative build dir with ./ prefix — shorter, copy-pastable.
  const { relative: rel, sep } = require("node:path") as typeof import("node:path");
  const relBuildDir = `.${sep}${rel(cfg.cwd, cfg.buildDir)}`;
  const lines: string[] = [
    `[configured] ${c.green(exe)}`,
    `  ${label("target")} ${cfg.os}-${cfg.arch}${cfg.abi !== undefined ? "-" + cfg.abi : ""}`,
    `  ${label("build type")} ${cfg.buildType}`,
    `  ${label("build dir")} ${relBuildDir}`,
    // Revision makes it obvious why configure re-ran after a commit
    // (the sha changes → zig's -Dsha arg changes → build.ninja differs).
    `  ${label("revision")} ${cfg.revision === "unknown" ? "unknown" : cfg.revision.slice(0, 10)}`,
  ];
  const features: string[] = [];
  if (cfg.lto) features.push("lto");
  if (cfg.asan) features.push("asan");
  if (cfg.assertions) features.push("assertions");
  if (cfg.logs) features.push("logs");
  if (cfg.baseline) features.push("baseline");
  if (cfg.valgrind) features.push("valgrind");
  if (cfg.fuzzilli) features.push("fuzzilli");
  if (!cfg.canary) features.push("canary:off");
  // Non-default modes — show so you notice when a build is unusual.
  if (cfg.webkit !== "prebuilt") features.push(`webkit:${cfg.webkit}`);
  if (cfg.mode !== "full") features.push(`mode:${cfg.mode}`);
  // Version pin overrides — show a short hash so you catch "forgot to
  // revert my WebKit test branch" before the build goes weird.
  if (cfg.webkitVersion !== versionDefaults.webkitVersion)
    features.push(`webkit-version:${cfg.webkitVersion.slice(0, 10)}`);
  if (cfg.zigCommit !== versionDefaults.zigCommit) features.push(`zig-commit:${cfg.zigCommit.slice(0, 10)}`);
  if (cfg.nodejsVersion !== versionDefaults.nodejsVersion) features.push(`nodejs:${cfg.nodejsVersion}`);
  lines.push(`  ${label("features")} ${features.length > 0 ? c.cyan(features.join(", ")) : c.dim("(none)")}`);
  return lines.join("\n");
}

/**
 * One-line "nothing changed" configure message. Bracketed to match the
 * [name] prefix style used by deps/zig.
 */
export function formatConfigUnchanged(exe: string, elapsed: number): string {
  return `[configured] ${c.green(exe)} in ${elapsed}ms ${c.dim("(unchanged)")}`;
}
