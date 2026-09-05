/**
 * Build profiles — named configuration presets.
 *
 * Stateless: every `bun run build --profile=X` resolves fresh. No persistence,
 * no stickiness. To override a single field, pass CLI flags on top of a profile.
 *
 * Each profile is a `PartialConfig`; `resolveConfig()` fills the rest with
 * defaults derived from the target platform + profile values.
 *
 * ## Naming convention
 *
 * `<buildtype>[-local][-<feature>]`
 *
 *   debug              → Debug build (the default). JSC is compiled from the
 *                        pinned WEBKIT_VERSION like every other dep.
 *   debug-local        → Debug build, WebKit compiled from your own clone
 *                        ($BUN_WEBKIT_PATH, default vendor/WebKit/)
 *   release            → Release build, no LTO
 *   release-local      → Release build, WebKit compiled from your own clone
 *   release-assertions → Release + runtime assertions enabled
 *   release-asan       → Release + address sanitizer
 *   ci-*               → CI-specific modes (cpp-only/link-only/full)
 *
 * If you don't specify a profile, `debug` is used.
 */

import type { PartialConfig } from "./config.ts";
import { BuildError } from "./error.ts";

export type ProfileName = keyof typeof profiles;

export const profiles = {
  /** Default local dev: debug build; JSC compiled from the pinned WEBKIT_VERSION. ASAN defaults on for supported platforms. */
  debug: {
    buildType: "Debug",
  },

  /** Debug, WebKit compiled from your clone (vendor/WebKit/, or $BUN_WEBKIT_PATH — see configure()). */
  "debug-local": {
    buildType: "Debug",
    localDeps: "WebKit=vendor/WebKit",
  },

  /** Debug without ASAN — faster builds, less safety. */
  "debug-no-asan": {
    buildType: "Debug",
    asan: false,
  },

  /**
   * Android aarch64 cross-compile. Requires ANDROID_NDK_ROOT.
   * Sanitizers are forced off in resolveConfig() regardless of profile.
   */
  android: {
    buildType: "Debug",
    os: "linux",
    arch: "aarch64",
    abi: "android",
  },

  "android-release": {
    buildType: "Release",
    os: "linux",
    arch: "aarch64",
    abi: "android",
  },

  /**
   * FreeBSD x64 cross-compile. Requires FREEBSD_SYSROOT (extracted base.txz).
   * Sanitizers are forced off in resolveConfig() regardless of profile.
   */
  freebsd: {
    buildType: "Debug",
    os: "freebsd",
    arch: "x64",
  },

  "freebsd-arm64": {
    buildType: "Debug",
    os: "freebsd",
    arch: "aarch64",
  },

  "freebsd-release": {
    buildType: "Release",
    os: "freebsd",
    arch: "x64",
  },

  /**
   * Windows cross-compile from a non-Windows host: clang-cl + lld-link from
   * the host LLVM plus an xwin-style Windows sysroot (see config.ts
   * `winsysroot`). On a Windows host just use the regular debug/release
   * profiles. Sanitizers are forced off in resolveConfig().
   */
  "windows-x64": {
    buildType: "Debug",
    os: "windows",
    arch: "x64",
  },

  "windows-arm64": {
    buildType: "Debug",
    os: "windows",
    arch: "aarch64",
  },

  "windows-x64-release": {
    buildType: "Release",
    os: "windows",
    arch: "x64",
  },

  "windows-arm64-release": {
    buildType: "Release",
    os: "windows",
    arch: "aarch64",
  },

  /** Release build for local testing. No LTO (that's CI-only). */
  release: {
    buildType: "Release",
    lto: false,
  },

  /**
   * Bench-till-green profile. Mirrors the codegen the CI release build
   * actually ships (`ci-release` resolves `lto: true` for ci+release+linux),
   * so PORT-vs-SYS comparisons measure what we'd actually ship — no PGO, no
   * symbol ordering, no special-case linker layout. lto=true compiles JSC
   * as ThinLTO bitcode with the rest (`-flto=thin -fwhole-program-vtables`)
   * so cross-TU inlining runs; a non-LTO build outlines JSC slow-paths and
   * the bench then reports a ~6-8% time / ~1 MB RSS "regression" that is
   * pure binary layout.
   */
  btg: {
    buildType: "Release",
    lto: true,
    // Pin the build dir so `--profile=btg` alone lands here and can never
    // be confused with `--profile=release --build-dir=build/btg` (which
    // would persist lto:false and silently de-LTO the bench binary).
    buildDir: "build/btg",
  },

  /** Release, WebKit compiled from your clone. */
  "release-local": {
    buildType: "Release",
    localDeps: "WebKit=vendor/WebKit",
    lto: false,
  },

  /**
   * Release + assertions + logs. RelWithDebInfo → cargo `release` profile
   * with `debug-assertions = true` (runtime safety checks), matching the
   * old cmake build:assert script.
   */
  "release-assertions": {
    buildType: "RelWithDebInfo",
    assertions: true,
    logs: true,
    lto: false,
  },

  /**
   * Release + ASAN + assertions. For testing prod-ish builds with
   * sanitizer — catches memory bugs that only manifest at -O3. Assertions
   * on too (the CMake build:asan did this) since if you're debugging
   * memory you probably also want the invariant checks.
   */
  "release-asan": {
    buildType: "Release",
    asan: true,
    assertions: true,
  },

  /** CI: compile C++ to libbun.a only (parallelized with the cargo build). */
  "ci-cpp-only": {
    buildType: "Release",
    mode: "cpp-only",
    ci: true,
    buildkite: true,
  },

  /**
   * CI: compile libbun_runtime.a only. Target platform via --os/--arch
   * overrides (cargo `--target <triple>`). Superseded in CI by
   * `ci-rust-and-link`; kept for ad-hoc rust-only builds.
   */
  "ci-rust-only": {
    buildType: "Release",
    mode: "rust-only",
    ci: true,
    buildkite: true,
  },

  /** CI: link prebuilt objects downloaded from sibling BuildKite jobs. */
  "ci-link-only": {
    buildType: "Release",
    mode: "link-only",
    ci: true,
    buildkite: true,
  },

  /**
   * CI: cargo build + link on one machine. Polls the sibling build-cpp step
   * for its archive/dep-lib artifacts, then links and packages. Saves an
   * agent spawn vs rust-only → link-only. Resolves the full toolchain (link
   * needs ld/strip/rc), unlike rust-only.
   */
  "ci-rust-and-link": {
    buildType: "Release",
    mode: "rust-and-link",
    ci: true,
    buildkite: true,
  },

  /** CI: deps + C++ + cargo + link on one agent; libbun-*.a, libbun_runtime.a and dep libs are uploaded as artifacts. */
  "ci-build": {
    buildType: "Release",
    mode: "archive-link",
    ci: true,
    buildkite: true,
  },

  /** CI full build with LTO. */
  "ci-release": {
    buildType: "Release",
    ci: true,
    buildkite: true,
    // lto default resolves to ON (ci + release + linux + !asan + !assertions)
  },
} as const satisfies Record<string, PartialConfig>;

/**
 * Look up a profile by name.
 */
export function getProfile(name: string): PartialConfig {
  if (name in profiles) {
    // The const assertion means values are readonly; spread into mutable PartialConfig.
    return { ...profiles[name as ProfileName] };
  }
  throw new BuildError(`Unknown profile: "${name}"`, {
    hint: `Available profiles: ${Object.keys(profiles).join(", ")}`,
  });
}
