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
 *   release            → Release build, prebuilt WebKit, no LTO
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

  /** Release build for local testing. No LTO (that's CI-only). */
  release: {
    buildType: "Release",
    webkit: "prebuilt",
    lto: false,
  },

  /** Release with local WebKit. */
  "release-local": {
    buildType: "Release",
    webkit: "local",
    lto: false,
  },

  /**
   * Release + assertions + logs. RelWithDebInfo → zig gets ReleaseSafe
   * (runtime safety checks), matching the old cmake build:assert script.
   */
  "release-assertions": {
    buildType: "RelWithDebInfo",
    webkit: "prebuilt",
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
    webkit: "prebuilt",
    asan: true,
    assertions: true,
  },

  /** CI: compile C++ to libbun.a only (parallelized with zig build). */
  "ci-cpp-only": {
    buildType: "Release",
    mode: "cpp-only",
    ci: true,
    buildkite: true,
    webkit: "prebuilt",
  },

  /**
   * CI: cross-compile bun-zig.o only. Target platform via --os/--arch
   * overrides (zig cross-compiles cleanly; this runs on a fast linux box).
   */
  "ci-zig-only": {
    buildType: "Release",
    mode: "zig-only",
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

  /** CI full build with LTO. */
  "ci-release": {
    buildType: "Release",
    ci: true,
    buildkite: true,
    webkit: "prebuilt",
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
