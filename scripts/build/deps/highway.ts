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

// The scalable SVE/SVE2 targets and SVE_256, which Highway starts building at clang >= 22, stay
// off: bun's movemask-style kernels (highway_json/xml/sourcemap.cpp) use BitsFromMask, which only
// fixed-width targets have. SVE2_128 (Neoverse V2/N2) is fixed-width and stays on, as before.
// highway_png.cpp puts a longer list in the place of this one.
//
// The other four would compile bun's kernels to the instructions of a target that stays on. The tables that
// HWY_EXPORT makes hold their addresses, so the linker's safe ICF folds none of them. AVX3_SPR is AVX3_ZEN4 again and
// AVX10_2 is AVX3_DL (one `vmovw` for a `vmovd`); NEON and NEON_BF16 are NEON_WITHOUT_AES. highway_dispatch.h picks the
// target that a CPU with AVX3_SPR takes instead.
const disabledTargets = "HWY_DISABLED_TARGETS=HWY_ALL_SVE-HWY_SVE2_128+HWY_AVX3_SPR+HWY_AVX10_2+HWY_NEON+HWY_NEON_BF16";

export const highway: Dependency = {
  name: "highway",

  source: () => ({
    kind: "github-archive",
    repo: "google/highway",
    commit: HIGHWAY_COMMIT,
  }),

  patches: ["patches/highway/silence-warnings.patch", "patches/highway/sve2-requires-sve.patch"],

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
      cflags: [
        `-D${disabledTargets}`,
        ...(cfg.windows ? ["-D_HAS_EXCEPTIONS=0"] : ["-fno-exceptions", "-fmath-errno"]),
      ],
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
    defines: [disabledTargets],
  }),
};
