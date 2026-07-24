/**
 * Build configuration.
 *
 * One flat struct. All derived booleans computed once in `resolveConfig()`,
 * passed everywhere. No `if(ENABLE_X)` depending on `if(CI)` depending on
 * `if(RELEASE)` — the chain is resolved here and the result is a plain value.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { homedir, arch as hostArch, platform as hostPlatform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { crossToolchains } from "./ci/spec.ts";
import { NODEJS_ABI_VERSION, NODEJS_V8_VERSION, NODEJS_VERSION } from "./deps/nodejs-headers.ts";
import { WEBKIT_VERSION } from "./deps/webkit.ts";
import { assert, BuildError } from "./error.ts";
import { resolveMacosSdkPath } from "./macos-sdk.ts";
import { clangTargetArch } from "./tools.ts";
import { cyan, dim, green } from "./tty.ts";

export type OS = "linux" | "darwin" | "windows" | "freebsd";
export type Arch = "x64" | "aarch64";
export type Abi = "gnu" | "musl" | "android";
export type BuildType = "Debug" | "Release" | "RelWithDebInfo" | "MinSizeRel";
export type BuildMode = "full" | "cpp-only" | "rust-only" | "link-only" | "rust-and-link";
export type WebKitMode = "prebuilt" | "local";

/**
 * Host platform — what's running the build. Distinguish from target
 * (Config.os/arch/windows) which is what we're building FOR.
 *
 * Host vs target matters for rust-only cross-compile: a linux CI box
 * can cross-compile libbun_rust.a for any linux abi/arch and (with the
 * right SDK) darwin. Target determines cargo's `--target` triple and
 * rustflags; host determines shell syntax (cmd vs sh), quoting, and
 * tool executable suffixes.
 *
 * For all other modes (full, cpp-only, link-only), host == target
 * unless cfg.crossTarget is set (currently: Android), in which case
 * the C++ side is cross-compiled via clang's --target/--sysroot.
 */
export interface Host {
  os: OS;
  arch: Arch;
  /** ".exe" on a Windows host, "" elsewhere. Mirrors Config.exeSuffix (target). */
  exeSuffix: string;
  /**
   * Host's Rust target triple — `host:` line from `rustc -vV`. Also the
   * `${sysroot}/lib/rustlib/<triple>/` directory name. Stamped at
   * `resolveConfig()` from `Toolchain.rustHostTriple` (so the toolchain
   * probe is the single source of truth); `undefined` only when no rustc
   * is installed.
   */
  rustTriple: string | undefined;
}

/**
 * Pinned version defaults. Each lives at the top of its own file
 * (deps/webkit.ts, deps/nodejs-headers.ts) — look there to bump.
 * Overridable via PartialConfig for testing (e.g. trying a WebKit branch).
 */
const versionDefaults = {
  nodejsVersion: NODEJS_VERSION,
  nodejsAbiVersion: NODEJS_ABI_VERSION,
  nodejsV8Version: NODEJS_V8_VERSION,
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
  freebsd: boolean;
  /** linux || darwin || freebsd */
  unix: boolean;
  /** darwin || freebsd — kqueue-based event loop */
  kqueue: boolean;
  x64: boolean;
  arm64: boolean;

  /**
   * What's running the build. Differs from os/arch/windows (target) in
   * rust-only cross-compile. Use for: shell syntax in rule commands,
   * quoteArgs(), tool executable suffixes. See Host type docs.
   */
  host: Host;
  /**
   * True when the linked binary can execute on this host (same os+arch, and on
   * linux same abi). Distinct from `crossTarget === undefined`: a native-arch
   * linux-gnu build still passes --target/--sysroot for glibc pinning but the
   * output runs fine here.
   */
  canRunOnHost: boolean;

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
  /**
   * Cross-language LTO: rustc emits LLVM bitcode (`-Clinker-plugin-lto`) into
   * `libbun_rust.a` so the final lld `-flto=thin` link sees through Rust↔C++
   * call edges. When false but `lto` is true, both halves still LTO
   * independently (C++ via `-flto=thin`, Rust via `[profile.release] lto =
   * "fat"`); only the cross-language inlining is lost.
   *
   * Normally tracks `lto`. Exists as a separate field so per-target toolchain
   * bugs can disable just the cross-language part without giving up LTO
   * entirely — see workarounds.ts "globalopt-crash-aarch64-musl".
   */
  crossLangLto: boolean;
  /** IR PGO: directory for .profraw output (instrumented build). Mutually exclusive with pgoUse. */
  pgoGenerate: string | undefined;
  /** IR PGO: .profdata file path (optimized build). Mutually exclusive with pgoGenerate. */
  pgoUse: string | undefined;
  asan: boolean;
  assertions: boolean;
  logs: boolean;
  /** x64-only: target nehalem (no AVX). Default true on x64 — the only x64 build we ship. */
  baseline: boolean;
  canary: boolean;
  /** MinSizeRel → optimize for size. */
  smol: boolean;
  staticSqlite: boolean;
  staticLibatomic: boolean;
  tinycc: boolean;
  valgrind: boolean;
  fuzzilli: boolean;
  /**
   * Compile usockets bsd_* syscall fault-injection hooks. Runtime-armed via
   * `bun:internal-for-testing` socketFaultInjection; disarmed cost is one
   * acquire atomic load per syscall, zero when compiled out.
   */
  socketFaultInjection: boolean;
  /** Bundle small .cpp files into unified TUs (WebKit-style). See unified.ts. */
  unifiedSources: boolean;
  /**
   * Archive each `direct` dep's objects into a per-dep .a (the old
   * behaviour). Default off — dep .o files go straight into bun's link/
   * cpp-only archive instead. Turn on to bisect duplicate-symbol issues:
   * a .a only contributes members the linker actually pulls.
   */
  archiveDeps: boolean;
  /** Emit clang -ftime-trace .json next to each .o for build profiling. */
  timeTrace: boolean;

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
  /**
   * Compiler for build-time host tools (dep_host_cc codegen helpers).
   * Same as `cc` except when cross-compiling for windows from a unix host,
   * where `cc` is clang-cl (emits COFF) and host tools need plain clang.
   */
  hostCc: string;
  /**
   * C++ driver for host-side links (cargo's host-triple linker in
   * `.cargo/config.toml` — build scripts, proc-macros). Same as `cxx`
   * except when cross-compiling for windows from a unix host.
   */
  hostCxx: string;
  /** Parsed X.Y.Z from clang --version. Captured once at resolve time. */
  clangVersion: string | undefined;
  /**
   * `clang -print-resource-dir` — builtin headers live at `<dir>/include`.
   * Used by darwin cross-compiles, which rebuild the C++ include search path
   * explicitly. undefined on Windows (nothing consumes it there).
   */
  clangResourceDir: string | undefined;
  ar: string;
  /** llvm-ranlib. undefined on windows (llvm-lib indexes itself). */
  ranlib: string | undefined;
  /**
   * ld.lld on linux, lld-link on windows, ld64.lld when cross-compiling for
   * darwin from a non-darwin host. May be empty on native darwin (clang
   * invokes the system linker).
   */
  ld: string;
  /**
   * rustc's bundled lld (see `Toolchain.rustLld`). When set and rustc's LLVM
   * is newer than clang's under LTO, `resolveConfig()` selects it as `cfg.ld`.
   * Forwarded so `validateBunConfig()` can fail loudly when LTO requires it
   * but it wasn't found (mismatched LLVM versions → "Invalid record" at link).
   */
  rustLld: string | undefined;
  /** Parsed `LLVM version:` from `rustc -vV`. Captured once; feeds workarounds.ts. */
  rustLlvmVersion: string | undefined;
  /**
   * `rustc --print sysroot`. Used to locate rustc's bundled `llvm-nm` for
   * reading LTO bitcode in `libbun_rust.a` — clang's `llvm-nm` may lag
   * rustc's LLVM major and reject the bitcode (#53609, #53656). Unlike
   * `rustLld`, this is needed regardless of whether cross-language LTO is
   * actually using rust-lld as the linker.
   */
  rustSysroot: string | undefined;
  strip: string;
  /** Set when the target is darwin. Undefined on non-darwin targets. */
  dsymutil: string | undefined;
  /** Self-host bun for codegen (bun install, bun build). */
  bun: string;
  /**
   * Shell-ready command prefix for running .ts subprocesses (stream.ts,
   * fetch-cli.ts, regen). Either the bun path or `node --experimental-strip-types`
   * depending on what's running configure. Already quoted — splice directly
   * into rule commands.
   */
  jsRuntime: string;
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
  /**
   * RUSTUP_TOOLCHAIN — the `channel` from this repo's `rust-toolchain.toml`.
   * Passed explicitly to every cargo invocation so the dep build and the
   * workspace build agree on libstd even when `vendor/` is a symlink into a
   * sibling worktree (rustup's directory walk follows the resolved path and
   * would otherwise pick up that worktree's pin).
   */
  rustToolchain: string | undefined;
  /** Windows: MSVC link.exe path (to avoid Git's /usr/bin/link shadowing). */
  msvcLinker: string | undefined;
  /** Windows: llvm-rc for nested cmake (CMAKE_RC_COMPILER). */
  rc: string | undefined;
  /** Windows: llvm-mt for nested cmake (CMAKE_MT). May be absent in some LLVM distros. */
  mt: string | undefined;
  /** Windows-x64: nasm for BoringSSL's NASM-syntax assembly. */
  nasm: string | undefined;

  // ─── macOS SDK (darwin only, undefined elsewhere) ───
  /** e.g. "13.0". Passed to deps as -DCMAKE_OSX_DEPLOYMENT_TARGET. */
  osxDeploymentTarget: string | undefined;
  /**
   * SDK path. Native darwin: from `xcrun --show-sdk-path`. Darwin
   * cross-compile from a non-darwin host: an extracted MacOSX*.sdk (see
   * macos-sdk.ts). Passed to deps as -DCMAKE_OSX_SYSROOT / `-isysroot`.
   */
  osxSysroot: string | undefined;

  // ─── Cross-compilation (set when host != target for C++) ───
  // Generic plumbing shared by every cross target (Android, FreeBSD,
  // macOS-from-Linux, and Windows-from-unix).
  /** clang `--target=` triple, e.g. "aarch64-unknown-linux-android28". undefined = native. */
  crossTarget: string | undefined;
  /** clang `--sysroot=` path. For Android: `<ndk>/toolchains/llvm/prebuilt/<host>/sysroot`. */
  sysroot: string | undefined;
  /**
   * Windows cross-compile only: root of an xwin-style splat of the MSVC
   * CRT/STL + Windows SDK laid out like a Visual Studio install
   * (`VC/Tools/MSVC/<ver>`, `Windows Kits/10`). Passed to clang-cl as
   * `/winsysroot` and to lld-link as `/winsysroot:` — the cross equivalent
   * of the INCLUDE/LIB env a VS dev shell provides on a Windows host.
   * undefined on native Windows builds (VS dev shell supplies the SDK).
   */
  winsysroot: string | undefined;
  /** Android NDK root. undefined when abi != "android". */
  androidNdk: string | undefined;
  /** Android API level (the N in `__ANDROID_API__=N`). undefined when abi != "android". */
  androidApiLevel: number | undefined;
  /** NDK compiler-rt/libunwind dir: `<ndk>/toolchains/llvm/prebuilt/<host>/lib/clang/<ver>/lib/linux`. */
  androidNdkRuntimeDir: string | undefined;
  /** FreeBSD release version targeted (e.g. "14.3"). undefined when os != "freebsd". */
  freebsdVersion: string | undefined;

  // ─── Versioning ───
  /** Bun's own version (from package.json). */
  version: string;
  /** Git commit of the bun checkout — feeds into the build's -Dsha equivalent. */
  revision: string;
  canaryRevision: string;
  /** Node.js compat version. Default in versions.ts; override to test a bump. */
  nodejsVersion: string;
  nodejsAbiVersion: string;
  nodejsV8Version: string;
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
  pgoGenerate?: string;
  pgoUse?: string;
  asan?: boolean;
  assertions?: boolean;
  logs?: boolean;
  baseline?: boolean;
  canary?: boolean;
  staticSqlite?: boolean;
  staticLibatomic?: boolean;
  tinycc?: boolean;
  valgrind?: boolean;
  fuzzilli?: boolean;
  socketFaultInjection?: boolean;
  unifiedSources?: boolean;
  archiveDeps?: boolean;
  timeTrace?: boolean;
  ci?: boolean;
  buildkite?: boolean;
  webkit?: WebKitMode;
  buildDir?: string;
  cacheDir?: string;
  /** Override NDK location (default: $ANDROID_NDK_ROOT etc). Only used when abi=android. */
  androidNdk?: string;
  /** Override Android API level (default: ANDROID_API_LEVEL_DEFAULT). Only used when abi=android. */
  androidApiLevel?: number;
  /** FreeBSD sysroot (extracted base.txz). Only used when os=freebsd. */
  freebsdSysroot?: string;
  /** FreeBSD release version (default: FREEBSD_VERSION_DEFAULT). Only used when os=freebsd. */
  freebsdVersion?: string;
  /** Linux glibc sysroot (pinned old glibc/libstdc++). Only used when linux && abi=gnu. */
  linuxSysroot?: string;
  /**
   * macOS SDK path (a MacOSX*.sdk directory). Only used when cross-compiling
   * for darwin from a non-darwin host; native darwin builds use xcrun.
   * Default: $MACOS_SDK_PATH, a well-known /opt install, or an auto-download
   * into the cache dir — see macos-sdk.ts.
   */
  macosSdk?: string;
  /**
   * macOS deployment target (`-mmacosx-version-min`). Only used when
   * cross-compiling for darwin from a non-darwin host (native darwin derives
   * it from the installed SDK / CI floor). Default: MIN_OSX_DEPLOYMENT_TARGET.
   */
  osxDeploymentTarget?: string;
  /** Windows sysroot (xwin splat, VS layout). Only used when cross-compiling for os=windows. */
  winsysroot?: string;
  // Version pins (defaults in versions.ts).
  nodejsVersion?: string;
  nodejsAbiVersion?: string;
  nodejsV8Version?: string;
  webkitVersion?: string;
}

/**
 * Resolved toolchain — found by tool discovery, passed in separately so
 * tests can mock it out.
 */
export interface Toolchain {
  cc: string;
  cxx: string;
  /**
   * Host compiler / C++ driver for build-time host tools and host-side
   * cargo links. Only set when they differ from `cc`/`cxx` (windows
   * cross-compile from a unix host, where cc/cxx are clang-cl);
   * resolveConfig() falls back to `cc`/`cxx` otherwise.
   */
  hostCc: string | undefined;
  hostCxx: string | undefined;
  /**
   * Parsed clang --version (X.Y.Z). Captured during toolchain resolution
   * so downstream checks (workarounds.ts) don't re-spawn. undefined if
   * version parsing failed — shouldn't happen since we version-gate cc.
   */
  clangVersion: string | undefined;
  /** `clang -print-resource-dir`. undefined on Windows. */
  clangResourceDir: string | undefined;
  ar: string;
  ranlib: string | undefined;
  ld: string;
  /**
   * lld's Mach-O port (`ld64.lld`), resolved on non-darwin unix hosts.
   * Swapped in as `cfg.ld` when the target is darwin and the host isn't —
   * there's no Apple `ld` to drive, and ld.lld only emits ELF.
   */
  ld64Lld: string | undefined;
  /**
   * rustc's bundled lld (`<sysroot>/lib/rustlib/<host>/bin/gcc-ld/ld.lld` on
   * unix, `.../bin/rust-lld.exe` on Windows). Used as `ld` for cross-language
   * LTO when rustc's LLVM is newer than clang's — LLVM bitcode is only
   * forward-compatible, so clang's lld can't read newer rust bitcode but
   * rust-lld can read clang's older bitcode. undefined when rustc isn't
   * installed or doesn't ship the rust-lld component.
   */
  rustLld: string | undefined;
  /** Parsed `LLVM version:` from `rustc -vV` (X.Y.Z). */
  rustLlvmVersion: string | undefined;
  /** `rustc --print sysroot` — see `Config.rustSysroot`. */
  rustSysroot: string | undefined;
  /** `host:` line from `rustc -vV` — stamped onto `Host.rustTriple` at resolveConfig. */
  rustHostTriple: string | undefined;
  strip: string;
  /**
   * llvm-strip. On Linux hosts GNU strip is the default (`strip` above) but
   * can't read Mach-O, so darwin cross-compiles swap this in as `cfg.strip`.
   */
  llvmStrip: string | undefined;
  dsymutil: string | undefined;
  bun: string;
  jsRuntime: string;
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
  /**
   * Windows only: nasm. BoringSSL's win-x64 assembly is NASM syntax;
   * clang's integrated assembler can't read it. win-aarch64 uses gas
   * .S files instead, so this is x64-only in practice.
   */
  nasm: string | undefined;
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
          : plat === "freebsd"
            ? "freebsd"
            : (() => {
                throw new BuildError(`Unsupported host platform: ${plat}`, {
                  hint: "Bun builds on linux, darwin, windows, or freebsd",
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

  // rustTriple is stamped later from Toolchain.rustHostTriple in resolveConfig
  // (the rustc probe is authoritative — distinguishes glibc/musl host etc.).
  return { os, arch, exeSuffix: os === "windows" ? ".exe" : "", rustTriple: undefined };
}

/**
 * Detect linux ABI (gnu vs musl) by checking for /etc/alpine-release.
 * Android is never auto-detected — it's always a cross-compile target,
 * so it must be requested explicitly via --abi=android.
 */
export function detectLinuxAbi(): Abi {
  return existsSync("/etc/alpine-release") ? "musl" : "gnu";
}

/**
 * Minimum Android API level we target. 28 = Android 9 (2018), the oldest
 * release with the bionic syscall wrappers we rely on without raw-syscall
 * fallbacks. Covers ~96% of active devices as of 2026.
 */
export const ANDROID_API_LEVEL_DEFAULT = 28;

/**
 * FreeBSD release we target. 14.x is the current production series; 14.3
 * is the oldest 14.x still on download.freebsd.org. Building against 14.3
 * produces binaries that run on 14.3+ (FreeBSD guarantees forward ABI
 * compat within a major).
 */
export const FREEBSD_VERSION_DEFAULT = crossToolchains.freebsdSysroot.version;

/**
 * Locate a FreeBSD sysroot (extracted base.txz). Checks env var then
 * well-known install paths. The sysroot is arch-specific (different
 * crt/libc for amd64 vs arm64), so when cross-compiling for arm64 we
 * look for the `-arm64` variant first. Returns undefined if none found.
 */
export function detectFreebsdSysroot(arch: Arch): string | undefined {
  const env = process.env.FREEBSD_SYSROOT;
  if (env && existsSync(join(env, "usr", "include", "sys", "param.h"))) return env;
  const candidates =
    arch === "aarch64"
      ? ["/opt/freebsd-sysroot-arm64", "/opt/freebsd-sysroot"]
      : ["/opt/freebsd-sysroot", "/opt/freebsd-sysroot-amd64"];
  for (const p of candidates) {
    if (existsSync(join(p, "usr", "include", "sys", "param.h"))) return p;
  }
  return undefined;
}

/**
 * Locate the linux-gnu sysroot: ubuntu:20.04 (glibc 2.31) + gcc-13 libstdc++,
 * matching the WebKit prebuilt's build environment. Arch-specific. See
 * the glibcSysroot component in scripts/build/ci/machine/components/linux/cross.ts.
 */
export function detectLinuxGlibcSysroot(arch: Arch): string | undefined {
  const looksValid = (p: string) => existsSync(join(p, "usr", "include", "c++", "13"));
  const env = process.env.LINUX_GLIBC_SYSROOT;
  if (env && looksValid(env)) return env;
  const candidate = arch === "aarch64" ? "/opt/linux-sysroot-glibc-arm64" : "/opt/linux-sysroot-glibc";
  return looksValid(candidate) ? candidate : undefined;
}

/**
 * Locate a linux-musl sysroot — alpine rootfs with musl + modern libstdc++;
 * see the muslSysroot component in scripts/build/ci/machine/components/linux/cross.ts. Checks env var then
 * well-known install paths. Arch-specific. Returns undefined if none found.
 */
export function detectLinuxMuslSysroot(arch: Arch): string | undefined {
  const looksValid = (p: string) => existsSync(join(p, "usr", "lib", "libc.so"));
  const env = process.env.LINUX_MUSL_SYSROOT;
  if (env && looksValid(env)) return env;
  const candidate = arch === "aarch64" ? "/opt/linux-sysroot-musl-arm64" : "/opt/linux-sysroot-musl";
  return looksValid(candidate) ? candidate : undefined;
}

/**
 * Locate a Windows sysroot (xwin splat of the MSVC CRT/STL + Windows SDK in
 * Visual Studio layout). Checks the env var then well-known install paths.
 * The splat contains both x64 and arm64 CRT/SDK libs, so unlike FreeBSD
 * there's no per-arch variant. Returns undefined if none found.
 */
export function detectWindowsSysroot(): string | undefined {
  // Case-tolerant: a real VS/SDK copy uses "Include", an xwin splat in
  // winsysroot-style mode writes "include" (winsysroot.ts adds the
  // title-case alias the LLVM toolchain needs at configure time).
  const looksValid = (p: string) =>
    existsSync(join(p, "Windows Kits", "10", "Include")) || existsSync(join(p, "Windows Kits", "10", "include"));
  const env = process.env.WINDOWS_SYSROOT;
  if (env && looksValid(env)) return env;
  for (const p of ["/opt/winsysroot", "/opt/xwin"]) {
    if (looksValid(p)) return p;
  }
  return undefined;
}

/**
 * Locate the Android NDK. Checks the conventional env vars in priority
 * order, then a couple of well-known install paths. Returns undefined if
 * none found — caller decides whether to error.
 */
export function detectAndroidNdk(): string | undefined {
  for (const v of ["ANDROID_NDK_ROOT", "ANDROID_NDK_HOME", "ANDROID_NDK"]) {
    const p = process.env[v];
    if (p && existsSync(join(p, "toolchains"))) return p;
  }
  for (const p of ["/opt/android-ndk", "/usr/local/android-ndk"]) {
    if (existsSync(join(p, "toolchains"))) return p;
  }
  // Android Studio's sdkmanager puts NDKs under $ANDROID_HOME/ndk/<version>.
  // We don't pick one automatically — too easy to get a stale version.
  return undefined;
}

/**
 * NDK toolchain prebuilt directory for the current build host. The NDK
 * ships one prebuilt per host OS (always x86_64; arm64 macOS runs it
 * under Rosetta).
 */
function ndkHostTag(host: Host): string {
  switch (host.os) {
    case "linux":
      return "linux-x86_64";
    case "darwin":
      return "darwin-x86_64";
    case "windows":
      return "windows-x86_64";
    case "freebsd":
      throw new BuildError("Android NDK does not ship FreeBSD prebuilts", {
        hint: "Cross-compile to Android from a Linux host",
      });
  }
}

/**
 * Make the host clang able to link Android binaries by symlinking the
 * NDK's compiler-rt builtins + libunwind into clang's resource dir.
 *
 * clang's driver emits a FULL PATH to `<resource-dir>/lib/<triple>/
 * libclang_rt.builtins.a` — there's no `-L`-style search, so the file
 * must exist at exactly that path. Our host clang has no Android-target
 * compiler-rt; the NDK does. This is the standard "bring your own clang"
 * setup for NDK cross-builds (Chromium does the same).
 *
 * Idempotent. Warns with a sudo hint if the resource dir isn't writable
 * (CI build images create the symlinks as root in scripts/build/ci/machine).
 */
function linkNdkRuntimesIntoClang(cc: string, ndk: string, host: Host, triple: string): void {
  const resourceDir = execSync(`"${cc}" -print-resource-dir`, { encoding: "utf8" }).trim();
  const targetDir = join(resourceDir, "lib", triple);
  // NDK r23+ layout: <prebuilt>/lib/clang/<ver>/lib/linux/<arch>/ for
  // libunwind.a + new-style libclang_rt.builtins.a
  const ndkPrebuilt = join(ndk, "toolchains", "llvm", "prebuilt", ndkHostTag(host));
  const ndkClangLib = join(ndkPrebuilt, "lib", "clang");
  // NDK ships exactly one clang version per release.
  const ndkClangVer = readdirSync(ndkClangLib)[0];
  if (ndkClangVer === undefined) {
    throw new BuildError(`NDK clang resource dir not found under ${ndkClangLib}`);
  }
  const arch = triple.startsWith("x86_64") ? "x86_64" : "aarch64";
  const ndkRtLinux = join(ndkClangLib, ndkClangVer, "lib", "linux");
  // Populate BOTH layouts: apt.llvm.org clang uses old-style flat
  // (lib/linux/libclang_rt.builtins-<arch>-android.a) while tarball builds use
  // per-triple (lib/<triple>/libclang_rt.builtins.a). NDK r27 keeps builtins in
  // the flat dir but libunwind in the per-arch subdir.
  const flatDir = join(resourceDir, "lib", "linux");
  const links = {
    [join(targetDir, "libclang_rt.builtins.a")]: join(ndkRtLinux, `libclang_rt.builtins-${arch}-android.a`),
    [join(targetDir, "libunwind.a")]: join(ndkRtLinux, arch, "libunwind.a"),
    [join(flatDir, `libclang_rt.builtins-${arch}-android.a`)]: join(
      ndkRtLinux,
      `libclang_rt.builtins-${arch}-android.a`,
    ),
    [join(flatDir, arch, "libunwind.a")]: join(ndkRtLinux, arch, "libunwind.a"),
  };
  if (Object.keys(links).every(dst => existsSync(dst))) return;
  try {
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(join(flatDir, arch), { recursive: true });
    for (const [dst, src] of Object.entries(links)) {
      if (!existsSync(dst)) symlinkSync(src, dst);
    }
  } catch (cause) {
    // Don't throw — rust-only mode doesn't need these, and on CI the image bootstrap
    // creates them as root during image build. The actual link step will fail
    // loudly later if they're genuinely missing where needed.
    const lnCmds = Object.entries(links)
      .map(([dst, src]) => `sudo ln -sf "${src}" "${dst}"`)
      .join(" && ");
    console.warn(
      `warning: could not link NDK compiler-rt into ${resourceDir} (${(cause as NodeJS.ErrnoException).code}). ` +
        `If the final link fails on libclang_rt.builtins.a, run: sudo mkdir -p "${targetDir}" "${join(flatDir, arch)}" && ${lnCmds}`,
    );
  }
}

/**
 * Resolve a PartialConfig into a full Config.
 *
 * This is where all the "X defaults to Y unless Z" chains get resolved into
 * concrete values. After this runs, everything downstream sees plain booleans.
 */
export function resolveConfig(partial: PartialConfig, toolchain: Toolchain): Config {
  const host = detectHost();
  host.rustTriple = toolchain.rustHostTriple;

  // ─── Target platform ───
  const os = partial.os ?? host.os;
  // Windows hosts: process.arch can be wrong under emulation (x64 bun on
  // arm64 hardware). Ask the compiler what it targets — CMake does the same
  // in project() to set CMAKE_SYSTEM_PROCESSOR. The found clang's default
  // target is what we actually build for. Cross-compiles from a unix host
  // skip this (the host clang-cl's default arch is just the host's).
  const compilerArch = os === "windows" && host.os === "windows" ? clangTargetArch(toolchain.cc) : undefined;
  const arch = partial.arch ?? compilerArch ?? host.arch;
  const abi: Abi | undefined = os === "linux" ? (partial.abi ?? detectLinuxAbi()) : undefined;

  const linux = os === "linux";
  const darwin = os === "darwin";
  const windows = os === "windows";
  const freebsd = os === "freebsd";
  const unix = linux || darwin || freebsd;
  const kqueue = darwin || freebsd;
  const x64 = arch === "x64";
  const arm64 = arch === "aarch64";
  // Darwin target on a non-darwin host (Linux CI box building macOS
  // binaries). Same host-clang + --target/-isysroot model as Android/FreeBSD,
  // with ld64.lld doing the Mach-O link. See the cross block further down.
  const darwinCross = darwin && host.os !== "darwin";
  // Windows target on a non-Windows host (clang-cl + lld-link + xwin
  // sysroot). See the cross block further down.

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
  // Android: force off. NDK ASAN deployment needs wrap.sh + runtime .so
  // shipping alongside the binary; UBSan likewise. Not worth the matrix.
  // FreeBSD: force off. Cross-compiled — we'd need to ship FreeBSD's
  // libclang_rt.asan, and there's no -asan WebKit prebuilt for it.
  // Darwin cross: force off. The Linux LLVM toolchain doesn't ship the
  // darwin ASAN/UBSan runtime dylibs (libclang_rt.*_osx_dynamic.dylib).
  // Windows cross: force off. The host clang doesn't ship the windows
  // clang_rt.asan runtime libs, so the link would fail.
  const asan =
    abi === "android" || freebsd || darwinCross || (windows && host.os !== "windows")
      ? false
      : (partial.asan ?? asanDefault);

  // Assertions: default on in debug OR asan. ASAN coupling is ABI-critical:
  // the -asan WebKit prebuilt is built with ASSERT_ENABLED=1, which gates
  // struct fields (RefCountDebugger etc). If bun's C++ isn't also compiled
  // with ASSERT_ENABLED=1, the struct layouts mismatch → crashes. CMake's
  // build:asan always set ENABLE_ASSERTIONS=ON for this reason.
  const assertions = partial.assertions ?? (debug || asan);

  // LTO: default on for CI release non-asan non-assertions builds across
  // linux, darwin-cross, and windows-cross. All three use ThinLTO (the JSC
  // ThinLTO miscompile was fixed upstream). The -lto WebKit prebuilts only
  // exist for the cross toolchain, so native windows/darwin stay non-LTO.
  const windowsCross = windows && host.os !== "windows";
  const ltoDefault = release && (linux || darwinCross || windowsCross) && ci && !assertions && !asan;
  let lto = partial.lto ?? ltoDefault;
  // ASAN and LTO don't mix — ASAN wins (silently, no warn — config is explicit).
  // Android: no LTO prebuilt WebKit exists; force off so the right tarball is fetched.
  // Windows arm64: oven-sh/WebKit ships no bun-webkit-windows-arm64-lto
  // (LLVM's CodeView emitter aborts on ARM64 NEON tuple registers).
  if ((asan && lto) || abi === "android" || (windows && arm64)) {
    lto = false;
  }

  // Cross-language LTO normally tracks `lto`. Gated off only for native
  // Windows hosts — there `ld` is the host LLVM's lld-link and no rust-lld
  // swap is wired up, so rustc's newer-LLVM bitcode would be unreadable at
  // link time. Both halves still LTO independently when this is false — only
  // the Rust↔C++ inlining is lost.
  // (aarch64-musl used to be gated too: LLVM's `globalopt` segfaulted on the
  // per-crate `bun_runtime` bitcode module during the merged link, CI build
  // #53109. That bitcode shape no longer exists — the Rust side is one fat,
  // pre-merged module since the CARGO_PROFILE_RELEASE_LTO=fat switch — so
  // the gate was lifted; see the deleted "globalopt-crash-aarch64-musl"
  // workarounds.ts entry if it ever needs to come back.)
  // Darwin cross uses the same rust-lld swap as ELF: rustc's sysroot ships
  // `gcc-ld/ld64.lld` (rust-lld in the Mach-O flavor, built against rustc's
  // LLVM), which findRustLld() already resolves for darwin targets, so the
  // newer-LLVM bitcode rustc emits under -Clinker-plugin-lto is readable at
  // link time. Windows cross does the same with the `gcc-ld/lld-link`
  // sibling (COFF flavor) — see the wantRustLld swap below.
  const crossLangLto = lto && !(windows && host.os === "windows");

  // Cross-language LTO bitcode-version skew: `-Clinker-plugin-lto` makes
  // rustc emit raw LLVM bitcode into libbun_rust.a. LLVM bitcode is
  // forward-compatible only (newer reader, older writer), so when rustc's
  // bundled LLVM is ahead of clang's, clang's ld.lld rejects the rust .o
  // files ("Unknown attribute kind"). rust-lld is built against rustc's
  // LLVM, so it reads both rustc's bitcode (same version) and clang's
  // (older, hence readable). Swap it in as `ld` for the whole build —
  // it's a stock lld, just newer, so non-LTO objects and nested cmake
  // deps link the same as before.
  //
  // Tracked in workarounds.ts ("rust-lld-for-crosslang-lto") so this
  // branch self-obsoletes once clang's LLVM catches up to rustc's.
  let ld = toolchain.ld;
  const clangMajor = majorOf(toolchain.clangVersion);
  const rustLlvmMajor = majorOf(toolchain.rustLlvmVersion);
  // Shared with the darwin-cross ld64 swap below: for darwin targets
  // findRustLld() resolves rustc's `gcc-ld/ld64.lld` (the Mach-O flavor of
  // the same rust-lld), so the swap composes with the cross toolchain.
  const wantRustLld =
    crossLangLto &&
    toolchain.rustLld !== undefined &&
    clangMajor !== undefined &&
    rustLlvmMajor !== undefined &&
    rustLlvmMajor > clangMajor;
  if (wantRustLld) {
    if (windows) {
      // Windows cross: `ld` must stay a COFF driver. `toolchain.rustLld` is
      // the flavor matching the *host* (gcc-ld/ld.lld on a Linux box);
      // rustc's gcc-ld/ directory ships every flavor of the same rust-lld,
      // so use the lld-link sibling. If rustc ever stops shipping it, fall
      // back to the host LLVM's lld-link — validateBunConfig() then fails
      // at configure time with the bitcode-version-skew message instead of
      // an opaque "Invalid record" at link time.
      const rustLldLink = join(dirname(toolchain.rustLld!), "lld-link");
      if (existsSync(rustLldLink)) {
        ld = rustLldLink;
      }
    } else {
      ld = toolchain.rustLld!;
    }
  }

  // PGO: paths resolved to absolute. generate/use are mutually exclusive.
  const pgoGenerate = partial.pgoGenerate ? resolve(partial.pgoGenerate) : undefined;
  const pgoUse = partial.pgoUse ? resolve(partial.pgoUse) : undefined;
  if (pgoGenerate && pgoUse) {
    throw new BuildError("--pgo-generate and --pgo-use are mutually exclusive");
  }

  // Logs: on by default in debug non-test
  const logs = partial.logs ?? debug;

  const baseline = partial.baseline ?? x64;
  const canary = partial.canary ?? true;
  const canaryRevision = canary ? "1" : "0";

  // Whether bun:sqlite and node:sqlite link the bundled sqlite3 directly
  // (LAZY_LOAD_SQLITE=0) or dlopen the system library at runtime. macOS
  // defaults to dlopen so both APIs share Apple's libsqlite3 (one library,
  // one POSIX-lock inode map — howtocorrupt.html §2.2.1); Linux/Windows
  // link the bundled amalgamation.
  const staticSqlite = partial.staticSqlite ?? !darwin;

  // Static libatomic: on by default. Arch/Manjaro don't ship libatomic.a —
  // those users pass --static-libatomic=off. Not auto-detected: the link
  // failure is loud ("cannot find -l:libatomic.a") and the fix is obvious.
  const staticLibatomic = partial.staticLibatomic ?? true;

  // TinyCC: off on Android (no upstream bionic support; FFI cc() falls back
  // to dlopen-only) and FreeBSD (oven-sh/tinycc has no FreeBSD target).
  const tinycc = partial.tinycc ?? !(abi === "android" || freebsd);

  const valgrind = partial.valgrind ?? false;
  const fuzzilli = partial.fuzzilli ?? false;
  // Default follows asan: on for local debug (Linux / arm64 macOS) and CI
  // release-asan, off everywhere else. The fuzz tests are most useful when
  // memory errors are detectable, and the disarmed-hot-path cost (one acquire
  // atomic load) is acceptable in asan builds but not in shipped release.
  const socketFaultInjection = partial.socketFaultInjection ?? asan;

  // ─── Paths ───
  const cwd = findRepoRoot();
  // Windows cross-compiles get their own default build dir — the native
  // build of the same profile (build/debug, build/release) already holds
  // host-target objects at the same obj/ paths, and mixing COFF into an ELF
  // build dir (or vice versa) forces a full rebuild each time you switch.
  const crossWindowsSuffix = windows && host.os !== "windows" ? `-windows-${arch}` : "";
  const defaultBuildDirName = computeBuildDirName({ debug, release, asan, assertions }) + crossWindowsSuffix;
  const buildDir =
    partial.buildDir !== undefined
      ? isAbsolute(partial.buildDir)
        ? partial.buildDir
        : resolve(cwd, partial.buildDir)
      : resolve(cwd, "build", defaultBuildDirName);
  const codegenDir = resolve(buildDir, "codegen");
  // Local builds share $BUN_INSTALL/build-cache across checkouts and profiles
  // so ccache/tarballs/webkit reuse one another's work. CI stays per-build
  // so runners remain hermetic and `rm -rf build/` is a full reset.
  // Relative BUN_INSTALL is anchored to repo root (not process.cwd()) so the
  // ninja regen rule — which runs from buildDir — resolves the same path.
  const bunInstall = process.env.BUN_INSTALL ? resolve(cwd, process.env.BUN_INSTALL) : join(homedir(), ".bun");
  const cacheDir =
    partial.cacheDir !== undefined
      ? isAbsolute(partial.cacheDir)
        ? partial.cacheDir
        : resolve(cwd, partial.cacheDir)
      : ci
        ? resolve(buildDir, "cache")
        : resolve(bunInstall, "build-cache");
  const vendorDir = resolve(cwd, "vendor");

  // ─── Validation ───
  assert(!baseline || x64, "baseline=true requires arch=x64 (baseline disables AVX which is x64-only)");
  assert(!valgrind || linux, "valgrind=true requires os=linux");
  assert(!(asan && valgrind), "Cannot enable both asan and valgrind simultaneously");
  assert(os !== "linux" || abi !== undefined, "Linux builds require an abi (gnu, musl, or android)");

  // ─── Cross-compilation (Android) ───
  // We keep using the host's clang (same version everywhere) and pass
  // --target/--sysroot. The NDK is needed only for its bionic sysroot,
  // libc++, and compiler-rt — not for its bundled clang.
  let crossTarget: string | undefined;
  let sysroot: string | undefined;
  let androidNdk: string | undefined;
  let androidApiLevel: number | undefined;
  let androidNdkRuntimeDir: string | undefined;
  if (abi === "android") {
    androidNdk =
      partial.androidNdk !== undefined
        ? isAbsolute(partial.androidNdk)
          ? partial.androidNdk
          : resolve(cwd, partial.androidNdk)
        : detectAndroidNdk();
    if (androidNdk === undefined) {
      throw new BuildError("--abi=android requires the Android NDK", {
        hint: "Set ANDROID_NDK_ROOT or pass --android-ndk=<path>. Download: https://developer.android.com/ndk/downloads",
      });
    }
    androidApiLevel = partial.androidApiLevel ?? ANDROID_API_LEVEL_DEFAULT;
    const ndkPrebuilt = join(androidNdk, "toolchains", "llvm", "prebuilt", ndkHostTag(host));
    sysroot = join(ndkPrebuilt, "sysroot");
    if (!existsSync(sysroot)) {
      throw new BuildError(`Android NDK sysroot not found at ${sysroot}`, {
        hint: `Is ANDROID_NDK_ROOT (${androidNdk}) a valid NDK? Expected r26 or newer.`,
      });
    }
    // NDK ships exactly one clang version per release.
    const ndkClangLib = join(ndkPrebuilt, "lib", "clang");
    const ndkClangVer = readdirSync(ndkClangLib)[0];
    if (ndkClangVer === undefined) {
      throw new BuildError(`NDK clang resource dir not found under ${ndkClangLib}`);
    }
    androidNdkRuntimeDir = join(ndkClangLib, ndkClangVer, "lib", "linux");
    const llvmArch = arch === "x64" ? "x86_64" : "aarch64";
    crossTarget = `${llvmArch}-unknown-linux-android${androidApiLevel}`;
    linkNdkRuntimesIntoClang(toolchain.cc, androidNdk, host, crossTarget);
  }

  // ─── Cross-compilation (FreeBSD) ───
  // Same pattern as Android: host clang + --target/--sysroot. The sysroot
  // is an extracted base.txz (libc, libc++, headers, crt files). When
  // building ON FreeBSD, no cross flags are needed.
  let freebsdVersion: string | undefined;
  if (freebsd) {
    freebsdVersion = partial.freebsdVersion ?? FREEBSD_VERSION_DEFAULT;
    if (host.os !== "freebsd") {
      sysroot =
        partial.freebsdSysroot !== undefined
          ? isAbsolute(partial.freebsdSysroot)
            ? partial.freebsdSysroot
            : resolve(cwd, partial.freebsdSysroot)
          : detectFreebsdSysroot(arch);
      if (sysroot === undefined) {
        const dlArch = arch === "x64" ? "amd64" : "arm64";
        const sysrootPath = arch === "x64" ? "/opt/freebsd-sysroot" : "/opt/freebsd-sysroot-arm64";
        throw new BuildError("--os=freebsd requires a FreeBSD sysroot when cross-compiling", {
          hint: `Set FREEBSD_SYSROOT or pass --freebsd-sysroot=<path>. Create one with: mkdir -p ${sysrootPath} && curl -L https://download.freebsd.org/releases/${dlArch}/${freebsdVersion}-RELEASE/base.txz | tar -C ${sysrootPath} -xJf - ./usr/include ./usr/lib ./lib`,
        });
      }
      const llvmArch = arch === "x64" ? "x86_64" : "aarch64";
      crossTarget = `${llvmArch}-unknown-freebsd${freebsdVersion}`;
      // No compiler-rt symlinking needed (unlike Android): FreeBSD's base
      // ships libgcc.a (which IS compiler-rt builtins, renamed for compat)
      // in /usr/lib, and clang's freebsd driver finds it via --sysroot.
    }
  }

  // ─── Linux-gnu/musl sysroot + target ───
  // Every CI linux-gnu build (native AND cross-arch) uses the ubuntu:20.04 +
  // gcc-13 sysroot so the glibc verneed matches what the --wrap list covers
  // and the libstdc++ ABI matches the WebKit prebuilt. musl uses an
  // alpine-derived sysroot. Local dev without a sysroot builds native.
  if (linux && abi !== "android" && crossTarget === undefined) {
    const llvmArch = x64 ? "x86_64" : "aarch64";
    const hostAbi = host.os === "linux" ? detectLinuxAbi() : undefined;
    const isCross = arch !== host.arch || abi !== hostAbi;
    if (abi === "musl") {
      sysroot = detectLinuxMuslSysroot(arch);
      if (sysroot !== undefined || isCross) {
        crossTarget = `${llvmArch}-alpine-linux-musl`;
        if (sysroot === undefined) {
          const p = arch === "aarch64" ? "/opt/linux-sysroot-musl-arm64" : "/opt/linux-sysroot-musl";
          throw new BuildError(`--os=linux --arch=${arch} --abi=musl requires a musl sysroot when cross-compiling`, {
            hint: `Set LINUX_MUSL_SYSROOT or provision ${p} (see the muslSysroot component in scripts/build/ci/machine/components/linux/cross.ts).`,
          });
        }
      }
    } else {
      sysroot =
        partial.linuxSysroot !== undefined
          ? isAbsolute(partial.linuxSysroot)
            ? partial.linuxSysroot
            : resolve(cwd, partial.linuxSysroot)
          : detectLinuxGlibcSysroot(arch);
      if (sysroot !== undefined || isCross) {
        crossTarget = `${llvmArch}-linux-gnu`;
        if (sysroot === undefined) {
          const p = arch === "aarch64" ? "/opt/linux-sysroot-glibc-arm64" : "/opt/linux-sysroot-glibc";
          throw new BuildError(`--os=linux --arch=${arch} --abi=gnu cross-compile requires a glibc sysroot`, {
            hint: `Set LINUX_GLIBC_SYSROOT or provision ${p} (see the glibcSysroot component in scripts/build/ci/machine/components/linux/cross.ts).`,
          });
        }
      }
    }
  }

  // ─── Cross-compilation (Windows) ───
  // Same pattern as Android/FreeBSD, with the MSVC spin: the host LLVM's
  // clang-cl/lld-link/llvm-lib/llvm-rc are used (tools.ts picks them by
  // target), and the "sysroot" is an xwin splat of the MSVC CRT/STL +
  // Windows SDK in Visual Studio layout, passed via /winsysroot instead of
  // --sysroot. Building ON Windows needs none of this — the VS dev shell
  // provides INCLUDE/LIB.
  let winsysroot: string | undefined;
  if (windows && host.os !== "windows") {
    winsysroot =
      partial.winsysroot !== undefined
        ? isAbsolute(partial.winsysroot)
          ? partial.winsysroot
          : resolve(cwd, partial.winsysroot)
        : detectWindowsSysroot();
    if (winsysroot === undefined) {
      if (ci || buildkite) {
        // CI always fetches its own sysroot into the per-build cache (see
        // winsysroot.ts `ensureWindowsSysroot`, called from configure.ts
        // before the graph is emitted) instead of relying on agent image
        // provisioning.
        winsysroot = resolve(cacheDir, "winsysroot");
      } else {
        throw new BuildError("--os=windows requires a Windows sysroot (MSVC CRT + Windows SDK) when cross-compiling", {
          hint:
            "Set WINDOWS_SYSROOT or pass --winsysroot=<path>. Create one with xwin (https://github.com/Jake-Shadle/xwin):\n" +
            "  cargo install xwin  (or download a release binary)\n" +
            // Keep the pinned versions in sync with WINDOWS_SDK_VERSION / MSVC_CRT_VERSION in winsysroot.ts.
            "  xwin --accept-license --arch x86_64,aarch64 --sdk-version 10.0.26100 --crt-version 14.44.17.14 --include-atl splat --use-winsysroot-style --preserve-ms-arch-notation --include-debug-libs --output /opt/winsysroot",
        });
      }
    }
    if (partial.webkit === "local") {
      throw new BuildError("Cross-compiling for Windows requires the prebuilt WebKit (webkit=local needs msbuild)", {
        hint: "Drop --webkit=local or build on a Windows host.",
      });
    }
    const llvmArch = arch === "x64" ? "x86_64" : "aarch64";
    crossTarget = `${llvmArch}-pc-windows-msvc`;
  }

  // ─── Versioning ───
  const pkgJsonPath = resolve(cwd, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version: string };
  const version = pkgJson.version;
  const revision = getGitRevision(cwd);

  // Defaults from versions.ts. Override via --webkit-version=<hash> etc.
  // to test a branch before bumping the pinned default.
  const nodejsVersion = partial.nodejsVersion ?? versionDefaults.nodejsVersion;
  const nodejsAbiVersion = partial.nodejsAbiVersion ?? versionDefaults.nodejsAbiVersion;
  const nodejsV8Version = partial.nodejsV8Version ?? versionDefaults.nodejsV8Version;
  const webkitVersion = partial.webkitVersion ?? versionDefaults.webkitVersion;

  // ─── macOS SDK ───
  // Must be passed to nested cmake builds or they'll pick the wrong SDK.
  // Native darwin: ask xcode-select/xcrun. Cross-compiling from a non-darwin
  // host: an extracted MacOSX*.sdk — explicit path, well-known install, or
  // auto-downloaded into the cache dir (see macos-sdk.ts / ensureMacosSdk()).
  let osxDeploymentTarget: string | undefined;
  let osxSysroot: string | undefined;
  if (darwin && host.os === "darwin") {
    ({ osxDeploymentTarget, osxSysroot } = detectMacosSdk(ci));
    if (partial.osxDeploymentTarget !== undefined) osxDeploymentTarget = partial.osxDeploymentTarget;
  }

  // ─── Cross-compilation (macOS from a non-darwin host) ───
  // Host clang + `--target=<arch>-apple-macosx` + `-isysroot <SDK>`, linked
  // with lld's Mach-O port (ld64.lld) and post-processed with llvm-strip /
  // dsymutil — all of which ship in the same LLVM install we already require.
  // The deployment target defaults to the CI floor (the SDK itself can be
  // newer; only `-mmacosx-version-min` decides what the binary runs on).
  let ld64StripSwap: { ld: string; strip: string } | undefined;
  if (darwinCross) {
    crossTarget = `${arm64 ? "arm64" : "x86_64"}-apple-macosx`;
    osxDeploymentTarget = partial.osxDeploymentTarget ?? MIN_OSX_DEPLOYMENT_TARGET;
    // rust-only mode never compiles C/C++ or links, so it doesn't need the
    // SDK — skip resolution so a rust-only build doesn't download
    // a ~730 MB sysroot it never reads.
    if ((partial.mode ?? "full") !== "rust-only") {
      osxSysroot = resolveMacosSdkPath(partial.macosSdk, cacheDir, cwd);
      if (toolchain.ld64Lld === undefined) {
        throw new BuildError("Cross-compiling for macOS requires ld64.lld (lld's Mach-O port)", {
          hint: "Install lld for the same LLVM version as clang: apt install lld-21 (or equivalent).",
        });
      }
      if (toolchain.llvmStrip === undefined) {
        throw new BuildError("Cross-compiling for macOS requires llvm-strip (GNU strip can't read Mach-O)", {
          hint: "Install llvm for the same version as clang: apt install llvm-21 (or equivalent).",
        });
      }
      if (toolchain.clangResourceDir === undefined) {
        throw new BuildError("Cross-compiling for macOS requires clang's resource directory", {
          hint: "`clang -print-resource-dir` failed — is the discovered clang runnable?",
        });
      }
      if (toolchain.dsymutil === undefined) {
        throw new BuildError("Cross-compiling for macOS requires LLVM dsymutil", {
          hint: "Install llvm for the same version as clang: apt install llvm-21 (or equivalent).",
        });
      }
      // The Mach-O flavor of whichever lld the rest of the config picked.
      // `toolchain.rustLld` is the flavor matching the *host* (gcc-ld/ld.lld
      // on a Linux box); rustc's gcc-ld/ directory ships every flavor of the
      // same rust-lld, so when the cross-language-LTO bitcode skew applies
      // (see wantRustLld above) the Mach-O link uses the ld64.lld sibling.
      // Falls back to clang's ld64.lld if rustc ever stops shipping it — the
      // configure-time assert in validateBunConfig catches the resulting
      // bitcode-version mismatch with a clear message.
      const rustLd64Lld =
        wantRustLld && toolchain.rustLld !== undefined ? join(dirname(toolchain.rustLld), "ld64.lld") : undefined;
      ld64StripSwap = {
        ld: rustLd64Lld !== undefined && existsSync(rustLd64Lld) ? rustLd64Lld : toolchain.ld64Lld,
        strip: toolchain.llvmStrip,
      };
    }
  }

  return {
    os,
    arch,
    abi,
    linux,
    darwin,
    windows,
    freebsd,
    unix,
    kqueue,
    x64,
    arm64,
    host,
    canRunOnHost: os === host.os && arch === host.arch && (!linux || abi === (detectLinuxAbi() ?? abi)),
    exeSuffix,
    objSuffix,
    libPrefix,
    libSuffix,
    buildType,
    debug,
    release,
    mode: partial.mode ?? "full",
    lto,
    crossLangLto,
    pgoGenerate,
    pgoUse,
    asan,
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
    socketFaultInjection,
    unifiedSources: partial.unifiedSources ?? true,
    archiveDeps: partial.archiveDeps ?? false,
    timeTrace: partial.timeTrace ?? false,
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
    hostCc: toolchain.hostCc ?? toolchain.cc,
    hostCxx: toolchain.hostCxx ?? toolchain.cxx,
    clangVersion: toolchain.clangVersion,
    clangResourceDir: toolchain.clangResourceDir,
    ar: toolchain.ar,
    ranlib: toolchain.ranlib,
    ld: ld64StripSwap?.ld ?? ld,
    rustLld: toolchain.rustLld,
    rustLlvmVersion: toolchain.rustLlvmVersion,
    rustSysroot: toolchain.rustSysroot,
    // Cross strips: linux-gnu uses <triple>-strip (GNU, handles -R .eh_frame
    // fully; host strip rejects foreign-arch ELF); other cross targets use
    // llvm-strip.
    strip:
      ld64StripSwap?.strip ??
      (crossTarget !== undefined
        ? linux && abi === "gnu" && existsSync(`/usr/bin/${crossTarget}-strip`)
          ? `/usr/bin/${crossTarget}-strip`
          : (toolchain.llvmStrip ?? toolchain.strip)
        : toolchain.strip),
    dsymutil: toolchain.dsymutil,
    bun: toolchain.bun,
    jsRuntime: toolchain.jsRuntime,
    esbuild: toolchain.esbuild,
    ccache: toolchain.ccache,
    cmake: toolchain.cmake,
    cargo: toolchain.cargo,
    cargoHome: toolchain.cargoHome,
    rustupHome: toolchain.rustupHome,
    rustToolchain: readRustToolchainChannel(cwd),
    // Cargo-driven links (the bun_shim_impl.exe edge, any future target
    // cdylib) must keep using a real lld-link/link.exe, not the gcc-ld/
    // lld-link wrapper `ld` may have been swapped to above: rustc treats a
    // linker living in its own sysroot's gcc-ld/ as the bundled rust-lld and
    // prepends `-flavor link`, which the wrapper forwards into the COFF
    // driver as bogus input args ("could not open 'link'"). Those links have
    // no LLVM bitcode in them, so the host LLVM's lld-link is always
    // sufficient — only the final clang-cl-driven bun.exe link needs the
    // newer rust-lld (and reaches it via the link rule's /clang:-B).
    msvcLinker: toolchain.msvcLinker ?? (windows && ld !== toolchain.ld ? toolchain.ld : undefined),
    rc: toolchain.rc,
    mt: toolchain.mt,
    nasm: toolchain.nasm,
    osxDeploymentTarget,
    osxSysroot,
    crossTarget,
    sysroot,
    winsysroot,
    androidNdk,
    androidApiLevel,
    androidNdkRuntimeDir,
    freebsdVersion,
    version,
    revision,
    nodejsVersion,
    nodejsV8Version,
    nodejsAbiVersion,
    canaryRevision,
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
/**
 * Parse the major component out of an X.Y.Z version string.
 * Returns undefined for undefined/unparseable input so callers can
 * compare without `!` assertions.
 */
function majorOf(version: string | undefined): number | undefined {
  if (version === undefined) return undefined;
  const m = version.match(/^(\d+)\./);
  return m ? Number(m[1]) : undefined;
}

/**
 * Read `channel` from `rust-toolchain.toml`. Passed as `RUSTUP_TOOLCHAIN` to
 * cargo invocations so vendored Rust deps and the workspace staticlib are
 * built with the same nightly — see `Config.rustToolchain` for why rustup's
 * own directory walk isn't sufficient when `vendor/` is a worktree-shared
 * symlink.
 *
 * Returns undefined if the file is missing (rustup then falls back to its
 * normal lookup, which is correct for the workspace build's cwd).
 */
function readRustToolchainChannel(cwd: string): string | undefined {
  const path = resolve(cwd, "rust-toolchain.toml");
  if (!existsSync(path)) return undefined;
  const m = /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(path, "utf8"));
  return m?.[1];
}

function getGitRevision(cwd: string): string {
  // CI env first — authoritative and zero-cost.
  const envSha = process.env.BUILDKITE_COMMIT ?? process.env.GITHUB_SHA ?? process.env.GIT_SHA;
  if (envSha !== undefined && envSha.length > 0) {
    return envSha;
  }
  try {
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

const c = { dim, cyan, green };

/**
 * Format a config for display (used at configure time).
 * `exe` is the output binary name (e.g. "bun-debug" or "bun-profile → bun (stripped)").
 */
export function formatConfig(cfg: Config, exe: string): string {
  const label = (s: string) => c.dim(s.padEnd(12));
  // Relative build dir with ./ prefix — shorter, copy-pastable.
  const relBuildDir = `.${sep}${relative(cfg.cwd, cfg.buildDir)}`;
  const lines: string[] = [
    `[configured] ${c.green(exe)}`,
    `  ${label("target")} ${cfg.os}-${cfg.arch}${cfg.abi !== undefined ? "-" + cfg.abi : ""}`,
    `  ${label("build type")} ${cfg.buildType}`,
    `  ${label("build dir")} ${relBuildDir}`,
    // Revision makes it obvious why configure re-ran after a commit
    // (the sha changes → the build's -Dsha equivalent changes → build.ninja differs).
    `  ${label("revision")} ${cfg.revision === "unknown" ? "unknown" : cfg.revision.slice(0, 10)}`,
  ];
  const features: string[] = [];
  if (cfg.lto) features.push("lto");
  if (cfg.pgoGenerate) features.push("pgo-gen");
  if (cfg.pgoUse) features.push("pgo-use");
  if (cfg.asan) features.push("asan");
  if (cfg.assertions) features.push("assertions");
  if (cfg.logs) features.push("logs");
  if (cfg.baseline) features.push("baseline");
  if (cfg.valgrind) features.push("valgrind");
  if (cfg.fuzzilli) features.push("fuzzilli");
  if (cfg.socketFaultInjection !== cfg.asan) {
    features.push(`socket-fault-injection:${cfg.socketFaultInjection ? "on" : "off"}`);
  }
  if (!cfg.canary) features.push("canary:off");
  // Non-default modes — show so you notice when a build is unusual.
  if (cfg.webkit !== "prebuilt") features.push(`webkit:${cfg.webkit}`);
  if (cfg.mode !== "full") features.push(`mode:${cfg.mode}`);
  // Version pin overrides — show an identifying value so you catch "forgot
  // to revert my WebKit test branch" before the build goes weird. Strip the
  // autobuild- prefix so preview tags show their sha instead of the prefix.
  if (cfg.webkitVersion !== versionDefaults.webkitVersion) {
    const v = cfg.webkitVersion.startsWith("autobuild-")
      ? cfg.webkitVersion.slice("autobuild-".length)
      : cfg.webkitVersion;
    features.push(`webkit-version:${/^[0-9a-f]{40}$/.test(v) ? v.slice(0, 10) : v}`);
  }
  if (cfg.nodejsVersion !== versionDefaults.nodejsVersion) features.push(`nodejs:${cfg.nodejsVersion}`);
  lines.push(`  ${label("features")} ${features.length > 0 ? c.cyan(features.join(", ")) : c.dim("(none)")}`);
  return lines.join("\n");
}

/**
 * One-line "nothing changed" configure message. Bracketed to match the
 * [name] prefix style used by deps.
 */
export function formatConfigUnchanged(exe: string, elapsed: number): string {
  return `[configured] ${c.green(exe)} in ${elapsed}ms ${c.dim("(unchanged)")}`;
}
