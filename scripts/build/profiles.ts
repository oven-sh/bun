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
 * `<buildtype>[-<webkit-mode>][-<feature>]`
 *
 *   debug              → Debug build, prebuilt WebKit (the default)
 *   debug-local        → Debug build, local WebKit (you cloned vendor/WebKit/)
 *   release            → Release build, prebuilt WebKit (LTO, as CI ships)
 *   release-local      → Release build, local WebKit
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
  /** Default local dev: debug + prebuilt WebKit. ASAN defaults on for supported platforms. */
  debug: {
    buildType: "Debug",
    webkit: "prebuilt",
  },

  /** Debug with local WebKit (user clones vendor/WebKit/). */
  "debug-local": {
    buildType: "Debug",
    webkit: "local",
  },

  /** Debug without ASAN — faster builds, less safety. */
  "debug-no-asan": {
    buildType: "Debug",
    webkit: "prebuilt",
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
    webkit: "prebuilt",
  },

  "android-release": {
    buildType: "Release",
    os: "linux",
    arch: "aarch64",
    abi: "android",
    webkit: "prebuilt",
  },

  /**
   * FreeBSD x64 cross-compile. Requires FREEBSD_SYSROOT (extracted base.txz).
   * Sanitizers are forced off in resolveConfig() regardless of profile.
   */
  freebsd: {
    buildType: "Debug",
    os: "freebsd",
    arch: "x64",
    webkit: "prebuilt",
  },

  "freebsd-arm64": {
    buildType: "Debug",
    os: "freebsd",
    arch: "aarch64",
    webkit: "prebuilt",
  },

  "freebsd-release": {
    buildType: "Release",
    os: "freebsd",
    arch: "x64",
    webkit: "prebuilt",
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
    webkit: "prebuilt",
  },

  "windows-arm64": {
    buildType: "Debug",
    os: "windows",
    arch: "aarch64",
    webkit: "prebuilt",
  },

  "windows-x64-release": {
    buildType: "Release",
    os: "windows",
    arch: "x64",
    webkit: "prebuilt",
  },

  "windows-arm64-release": {
    buildType: "Release",
    os: "windows",
    arch: "aarch64",
    webkit: "prebuilt",
  },

  /**
   * Release build: the codegen CI ships (ThinLTO across bun, the `-lto`
   * WebKit prebuilt's bitcode and Rust; no PGO or symbol ordering — those are
   * CI post-steps). `--lto=off` trades that for fast relinks while iterating.
   */
  release: {
    buildType: "Release",
    webkit: "prebuilt",
  },

  /** Release with local WebKit. */
  "release-local": {
    buildType: "Release",
    webkit: "local",
    lto: false,
  },

  /**
   * Release + assertions + logs. RelWithDebInfo → cargo `release` profile
   * with `debug-assertions = true` (runtime safety checks), matching the
   * old cmake build:assert script.
   */
  "release-assertions": {
    buildType: "RelWithDebInfo",
    webkit: "prebuilt",
    assertions: true,
    logs: true,
  },

  /**
   * Release + ASAN + assertions. For testing prod-ish builds with
   * sanitizer — catches memory bugs that only manifest at -O3. Assertions
   * on too (the CMake build:asan did this) since if you're debugging
   * memory you probably also want the invariant checks.
   */
  "release-asan": {
    buildType: "Release",
    webkit: "prebuilt",
    asan: true,
    assertions: true,
  },

  /** CI: compile C++ to libbun.a only (parallelized with the cargo build). */
  "ci-cpp-only": {
    buildType: "Release",
    mode: "cpp-only",
    ci: true,
    buildkite: true,
    webkit: "prebuilt",
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
    webkit: "prebuilt",
  },

  /** CI: link prebuilt objects downloaded from sibling BuildKite jobs. */
  "ci-link-only": {
    buildType: "Release",
    mode: "link-only",
    ci: true,
    buildkite: true,
    webkit: "prebuilt",
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
    webkit: "prebuilt",
  },

  /** CI: deps + C++ + cargo + link on one agent; libbun-*.a, libbun_runtime.a and dep libs are uploaded as artifacts. */
  "ci-build": {
    buildType: "Release",
    mode: "archive-link",
    ci: true,
    buildkite: true,
    webkit: "prebuilt",
  },
} as const satisfies Record<string, PartialConfig>;

/**
 * Look up a profile by name.
 */
/** Profiles that were removed, with what replaces them — a build dir configured under one says so on its next regen. */
const retiredProfiles: Record<string, string> = {
  btg: "--profile=release (LTO is on by default now)",
  "ci-release": "--profile=release --ci=on --buildkite=on (LTO is on by default now)",
};

export function getProfile(name: string): PartialConfig {
  if (name in retiredProfiles) {
    throw new BuildError(`Profile "${name}" no longer exists; use ${retiredProfiles[name]}`, {
      hint: "Re-run the build script with the new flags for this build dir (that rewrites its configure.json), or remove the build dir",
    });
  }
  if (name in profiles) {
    // The const assertion means values are readonly; spread into mutable PartialConfig.
    return { ...profiles[name as ProfileName] };
  }
  throw new BuildError(`Unknown profile: "${name}"`, {
    hint: `Available profiles: ${Object.keys(profiles).join(", ")}`,
  });
}
