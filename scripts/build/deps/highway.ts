/**
 * Google Highway — portable SIMD intrinsics with runtime dispatch. Used by
 * bun's string search (indexOf fastpaths), base64 codec, and the bundler's
 * chunk hashing.
 *
 * Highway compiles every function for multiple targets (SSE2/AVX2/NEON/etc.)
 * and picks at runtime. It needs NO per-file `-m` flags or
 * generated config — `hwy/foreach_target.h` re-includes each TU body once
 * per ISA wrapped in `#pragma clang attribute push(target("..."))`, so a
 * single baseline compile per .cc emits all variants.
 */

import type { Dependency, DirectBuild } from "../source.ts";

const HIGHWAY_COMMIT = "2607d3b5b0113992fe84d3848859eae13b3b52c1";

// No SVE: bun's kernels use BitsFromMask, which only fixed-width targets have, and keep vectors in arrays.
// SVE2_128 is no wider than NEON, and Neoverse V2 compares into predicates at a quarter of the rate.
// AVX3 is what Skylake-X and Cascade Lake would take, which lower their clock after a 512-bit instruction.
// highway_{png,jpeg,checksums,brotli,byte_set,zlib,zstd}.cpp and highway_webp_*.cpp put another list in the place of this one.
const disabledTargets = "HWY_DISABLED_TARGETS=HWY_ALL_SVE+HWY_AVX3";

// Lets CPUs and VMs without AES or PCLMULQDQ have AVX2. highway_checksums.cpp checks for the latter itself.
const sharedDefines = [disabledTargets, "HWY_DISABLE_PCLMUL_AES"];

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
        ...sharedDefines.map(define => `-D${define}`),
        ...(cfg.windows ? ["-D_HAS_EXCEPTIONS=0"] : ["-fno-exceptions", "-fmath-errno"]),
      ],
    };

    // clang-cl on arm64-windows doesn't define __ARM_NEON even though NEON
    // intrinsics work. Highway's cpu-feature detection is gated on the macro,
    // so without it you get a scalar-only build. The underlying clang does
    // support NEON here — it's a clang-cl frontend quirk.
    if (cfg.windows && cfg.arm64) spec.cflags!.push("-D__ARM_NEON=1");

    // The headers of the glibc sysroot are those of Linux 5.4. The bit is from 5.6 (arch/arm64/include/uapi/asm/hwcap.h).
    if (cfg.arm64 && cfg.abi === "gnu") spec.cflags!.push("-DHWCAP2_BF16=0x4000");

    return spec;
  },

  provides: () => ({
    libs: [],
    // Highway's public header is <hwy/highway.h> but it includes siblings
    // via "" paths — need both the root and the hwy/ subdir in -I.
    includes: [".", "hwy"],
    defines: sharedDefines,
  }),
};
