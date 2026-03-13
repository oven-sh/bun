/**
 * Google Highway — portable SIMD intrinsics with runtime dispatch. Used by
 * bun's string search (indexOf fastpaths), base64 codec, and the bundler's
 * chunk hashing.
 *
 * Highway compiles every function for multiple targets (SSE2/AVX2/NEON/etc.)
 * and picks at runtime. That's why it needs PIC — the dispatch tables are
 * function pointers.
 */

import type { Dependency, NestedCmakeBuild } from "../source.ts";

const HIGHWAY_COMMIT = "ac0d5d297b13ab1b89f48484fc7911082d76a93f";

export const highway: Dependency = {
  name: "highway",

  source: () => ({
    kind: "github-archive",
    repo: "google/highway",
    commit: HIGHWAY_COMMIT,
  }),

  patches: ["patches/highway/silence-warnings.patch"],

  build: cfg => {
    const spec: NestedCmakeBuild = {
      kind: "nested-cmake",
      pic: true,
      args: {
        HWY_ENABLE_TESTS: "OFF",
        HWY_ENABLE_EXAMPLES: "OFF",
        HWY_ENABLE_CONTRIB: "OFF",
        HWY_ENABLE_INSTALL: "OFF",
      },
    };

    // clang-cl on arm64-windows doesn't define __ARM_NEON even though NEON
    // intrinsics work. Highway's cpu-feature detection is gated on the macro,
    // so without it you get a scalar-only build. The underlying clang does
    // support NEON here — it's a clang-cl frontend quirk.
    if (cfg.windows && cfg.arm64) {
      spec.extraCFlags = ["-D__ARM_NEON=1"];
      spec.extraCxxFlags = ["-D__ARM_NEON=1"];
    }

    return spec;
  },

  provides: () => ({
    libs: ["hwy"],
    // Highway's public header is <hwy/highway.h> but it includes siblings
    // via "" paths — need both the root and the hwy/ subdir in -I.
    includes: [".", "hwy"],
  }),
};
