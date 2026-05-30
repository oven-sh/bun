/**
 * Google Highway — portable SIMD intrinsics with runtime dispatch. Used by
 * bun's string search (indexOf fastpaths), base64 codec, and the bundler's
 * chunk hashing.
 *
 * Highway compiles every function for multiple targets (SSE2/AVX2/NEON/etc.)
 * and picks at runtime. Unlike zlib-ng it needs NO per-file `-m` flags or
 * generated config — `hwy/foreach_target.h` re-includes each TU body once
 * per ISA wrapped in `#pragma clang attribute push(target("..."))`, so a
 * single baseline compile per .cc emits all variants.
 */

import type { Dependency, DirectBuild } from "../source.ts";

const HIGHWAY_COMMIT = "2607d3b5b0113992fe84d3848859eae13b3b52c1";

export const highway: Dependency = {
  name: "highway",

  source: () => ({
    kind: "github-archive",
    repo: "google/highway",
    commit: HIGHWAY_COMMIT,
  }),

  patches: ["patches/highway/silence-warnings.patch"],

  build: cfg => {
    const spec: DirectBuild = {
      kind: "direct",
      lang: "cxx",
      pic: true,
      sources: [
        "hwy/abort.cc",
        "hwy/aligned_allocator.cc",
        "hwy/nanobenchmark.cc",
        "hwy/per_target.cc",
        "hwy/perf_counters.cc",
        "hwy/print.cc",
        "hwy/profiler.cc",
        "hwy/targets.cc",
        "hwy/timer.cc",
      ],
      includes: ["."],
      defines: { HWY_STATIC_DEFINE: true },
      // -fno-exceptions / -fmath-errno aren't CLOptions (clang-cl warns
      // "unknown argument ignored"). globalFlags supplies /EHs-c- and /GR-
      // on Windows; upstream's MSVC branch additionally sets the STL macro.
      cflags: cfg.windows ? ["-D_HAS_EXCEPTIONS=0"] : ["-fno-exceptions", "-fmath-errno"],
    };

    // clang-cl on arm64-windows doesn't define __ARM_NEON even though NEON
    // intrinsics work. Highway's cpu-feature detection is gated on the macro,
    // so without it you get a scalar-only build. The underlying clang does
    // support NEON here — it's a clang-cl frontend quirk.
    if (cfg.windows && cfg.arm64) spec.cflags!.push("-D__ARM_NEON=1");

    return spec;
  },

  provides: () => ({
    libs: [],
    // Highway's public header is <hwy/highway.h> but it includes siblings
    // via "" paths — need both the root and the hwy/ subdir in -I.
    includes: [".", "hwy"],
  }),
};
