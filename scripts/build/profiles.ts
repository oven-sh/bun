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
 *   debug              → Debug build, the pinned WebKit (the default)
 *   debug-local        → Debug build, local WebKit (you cloned vendor/WebKit/)
 *   release            → Release build, the pinned WebKit (LTO, as CI ships)
 *   release-local      → Release build, local WebKit
 *   release-assertions → Release + runtime assertions enabled
 *   release-asan       → Release + address sanitizer
 *   ci-build           → what CI runs: the full build, linked from an object archive
 *
 * If you don't specify a profile, `debug` is used.
 *
 * A profile that does not say which WebKit compiles the pinned one (`webkit: "source"`), or the checkout that
 * `--local-deps=WebKit=<path>` names.
 */

import type { PartialConfig } from "./config.ts";
import { BuildError } from "./error.ts";

export type ProfileName = keyof typeof profiles;

export const profiles = {
  /** Default local dev: debug. ASAN defaults on for supported platforms. */
  debug: {
    buildType: "Debug",
  },

  /** Debug with local WebKit (user clones vendor/WebKit/). */
  "debug-local": {
    buildType: "Debug",
    webkit: "local",
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

  /**
   * Release build: the codegen CI ships (ThinLTO across bun, WebKit and Rust;
   * no PGO or symbol ordering — those are CI post-steps). `--lto=off` trades
   * that for fast relinks while iterating.
   */
  release: {
    buildType: "Release",
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
    asan: true,
    assertions: true,
  },

  /** CI: a release build on one agent; build.ts packages and uploads the zips (scripts/build/ci.ts). */
  "ci-build": {
    buildType: "Release",
    ci: true,
    buildkite: true,
    trimmable: true,
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
