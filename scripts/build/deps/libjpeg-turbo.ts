/**
 * libjpeg-turbo — the de-facto JPEG codec. Backs Bun.Image JPEG
 * decode/encode via the high-level TurboJPEG API (turbojpeg.h).
 *
 * DirectBuild. SIMD: arm64 uses the full Neon intrinsics path (no GAS, no
 * jsimd_neon.S — clang has the complete vld1_* set so NEON_INTRINSICS=1 is
 * the upstream default there). x64 assembles the upstream NASM SSE2/AVX2
 * kernels; simd/x86_64/jsimd.c picks between them per call from cpuid at
 * runtime, so the AVX2 objects are safe under the -march=nehalem floor.
 * The hand-written jconfig.h/jconfigint.h below replace cmake's
 * configure_file — the only probes that matter are sizeof(size_t) and
 * __builtin_ctzl, both known per target.
 *
 * 12/16-bit sample depths and the lossless codec are compiled out
 * (turbojpeg.c gates them on `#ifdef NO_PRECISION_EXT`); Bun.Image only
 * deals in 8-bit RGB(A).
 */

import { quote } from "../shell.ts";
import type { Dependency } from "../source.ts";
import { depBuildDir, depSourceDir } from "../source.ts";

const LIBJPEG_TURBO_COMMIT = "e352b02f794f701407b39af08576035ba3360d60"; // 3.1.4

const VERSION = "3.1.4";

// CMakeLists.txt's JPEG_SOURCES expanded.
// prettier-ignore
const JPEG8 = [
  // compress
  "jcapimin", "jcapistd", "jccoefct", "jccolor", "jcdctmgr", "jcdiffct",
  "jchuff", "jcicc", "jcinit", "jclhuff", "jclossls", "jcmainct", "jcmarker",
  "jcmaster", "jcomapi", "jcparam", "jcphuff", "jcprepct", "jcsample", "jctrans",
  // decompress
  "jdapimin", "jdapistd", "jdatadst", "jdatasrc", "jdcoefct", "jdcolor",
  "jddctmgr", "jddiffct", "jdhuff", "jdicc", "jdinput", "jdlhuff", "jdlossls",
  "jdmainct", "jdmarker", "jdmaster", "jdmerge", "jdphuff", "jdpostct",
  "jdsample", "jdtrans",
  // dct
  "jfdctflt", "jfdctfst", "jfdctint", "jidctflt", "jidctfst", "jidctint",
  "jidctred",
  // misc
  "jaricom", "jcarith", "jdarith", "jerror", "jmemmgr", "jmemnobs",
  "jquant1", "jquant2", "jutils", "jpeg_nbits",
];

// 8bit-only.patch gates the BMP/PPM file-I/O entry points and the 12/16-bit
// turbojpeg-mp.c re-includes behind BUN_8BIT_ONLY, so rdbmp/rdppm/wrbmp/wrppm
// and the second/third-precision JPEG12/JPEG16 source sets are dropped.
const TURBOJPEG = ["turbojpeg", "transupp", "jdatadst-tj", "jdatasrc-tj"];

// simd/CMakeLists.txt SIMD_SOURCES for arm64 with NEON_INTRINSICS=1, BITS=64.
// jccolext-neon.c / jcgryext-neon.c / jdcolext-neon.c / jdmrgext-neon.c are
// #include'd by jccolor/jcgray/jdcolor/jdmerge, not compiled standalone.
// prettier-ignore
const SIMD_ARM64 = [
  "arm/jcgray-neon", "arm/jcphuff-neon", "arm/jcsample-neon",
  "arm/jdmerge-neon", "arm/jdsample-neon", "arm/jfdctfst-neon",
  "arm/jidctred-neon", "arm/jquanti-neon",
  // NEON_INTRINSICS only:
  "arm/jccolor-neon", "arm/jidctint-neon",
  // NEON_INTRINSICS || BITS==64:
  "arm/jidctfst-neon",
  // NEON_INTRINSICS || BITS==32:
  "arm/aarch64/jchuff-neon", "arm/jdcolor-neon", "arm/jfdctint-neon",
  // dispatcher (provides jsimd_can_* / jsimd_* the core calls when WITH_SIMD):
  "arm/aarch64/jsimd",
];

// simd/CMakeLists.txt SIMD_SOURCES for x86_64; the *ext-*.asm files are %include'd, not assembled.
// prettier-ignore
const SIMD_X64 = [
  "x86_64/jsimdcpu", "x86_64/jfdctflt-sse",
  "x86_64/jccolor-sse2", "x86_64/jcgray-sse2", "x86_64/jchuff-sse2",
  "x86_64/jcphuff-sse2", "x86_64/jcsample-sse2", "x86_64/jdcolor-sse2",
  "x86_64/jdmerge-sse2", "x86_64/jdsample-sse2", "x86_64/jfdctfst-sse2",
  "x86_64/jfdctint-sse2", "x86_64/jidctflt-sse2", "x86_64/jidctfst-sse2",
  "x86_64/jidctint-sse2", "x86_64/jidctred-sse2", "x86_64/jquantf-sse2",
  "x86_64/jquanti-sse2",
  "x86_64/jccolor-avx2", "x86_64/jcgray-avx2", "x86_64/jcsample-avx2",
  "x86_64/jdcolor-avx2", "x86_64/jdmerge-avx2", "x86_64/jdsample-avx2",
  "x86_64/jfdctint-avx2", "x86_64/jidctint-avx2", "x86_64/jquanti-avx2",
];

// `#cmakedefine X` → `#define X` / comment, configure_file-style. We resolve
// the handful of probes we know per target instead of running cmake.
const cmakedefine = (truthy: boolean): [string, string] => ["#cmakedefine", truthy ? "#define" : "// #undef"];

export const libjpegTurbo: Dependency = {
  name: "libjpeg-turbo",

  source: () => ({
    kind: "github",
    repo: "libjpeg-turbo/libjpeg-turbo",
    commit: LIBJPEG_TURBO_COMMIT,
  }),

  patches: ["patches/libjpeg-turbo/8bit-only.patch", "patches/libjpeg-turbo/jbun_stubs.c"],

  build: cfg => {
    const withSimd: [string, string] = ["#cmakedefine WITH_SIMD 1", "#define WITH_SIMD 1"];
    const srcDir = depSourceDir(cfg, "libjpeg-turbo");
    const hostWin = cfg.host.os === "windows";
    return {
      kind: "direct",
      sources: [
        ...JPEG8.map(f => `src/${f}.c`),
        ...TURBOJPEG.map(f => `src/${f}.c`),
        "jbun_stubs.c",
        ...(cfg.arm64 ? SIMD_ARM64.map(f => `simd/${f}.c`) : []),
        ...(cfg.x64 ? ["simd/x86_64/jsimd.c", ...SIMD_X64.map(f => `simd/${f}.asm`)] : []),
      ],
      // Mirrors simd/CMakeLists.txt; nasm wants -I with a trailing slash.
      nasmflags: cfg.x64
        ? [
            cfg.windows ? "-fwin64" : cfg.darwin ? "-fmacho64" : "-felf64",
            cfg.windows ? "-DWIN64" : cfg.darwin ? "-DMACHO" : "-DELF",
            "-D__x86_64__",
            `-I${quote(srcDir + "/simd/nasm/", hostWin)}`,
            `-I${quote(srcDir + "/simd/x86_64/", hostWin)}`,
          ]
        : [],
      // simd/arm is needed for the bare `#include "align.h"` / `"neon-compat.h"`
      // in the intrinsics TUs; the generated neon-compat.h lands in depBuildDir,
      // which emitDirect already puts on the include path (jconfig.h relies on
      // the same).
      includes: ["src", ...(cfg.arm64 ? ["simd/arm"] : [])],
      defines: {
        BUN_8BIT_ONLY: true,
        ...(cfg.arm64 ? { NEON_INTRINSICS: true } : {}),
        // jpeg_nbits.h only defines this itself on Arm. The C Huffman encoders
        // (jcphuff.c always, jchuff.c when SIMD is off) then use bsr instead of
        // jpeg_nbits_table. The 64 KB table still ships on x64: jchuff-sse2.asm
        // carries its own copy.
        ...(cfg.arm64 ? {} : { USE_CLZ_INTRINSIC: true }),
      },
      headers: {
        "jconfig.h": {
          from: "src/jconfig.h.in",
          replace: [
            ["@JPEG_LIB_VERSION@", "80"],
            ["@VERSION@", VERSION],
            ["@LIBJPEG_TURBO_VERSION_NUMBER@", "3001004"],
            withSimd,
            ["#cmakedefine RIGHT_SHIFT_IS_UNSIGNED 1", "/* #undef RIGHT_SHIFT_IS_UNSIGNED */"],
            cmakedefine(true), // C_/D_ARITH_CODING_SUPPORTED
          ],
        },
        "jconfigint.h": {
          from: "src/jconfigint.h.in",
          replace: [
            ["@BUILD@", "bun"],
            ["@HIDDEN@", cfg.windows ? "" : '__attribute__((visibility("hidden")))'],
            ["@INLINE@", cfg.windows ? "__forceinline" : "inline __attribute__((always_inline))"],
            ["@THREAD_LOCAL@", cfg.windows ? "__declspec(thread)" : "__thread"],
            ["@CMAKE_PROJECT_NAME@", "libjpeg-turbo"],
            ["@VERSION@", VERSION],
            ["@SIZE_T@", "8"],
            withSimd,
            ["#cmakedefine HAVE_BUILTIN_CTZL", cfg.windows ? "/* */" : "#define HAVE_BUILTIN_CTZL"],
            ["#cmakedefine HAVE_INTRIN_H", cfg.windows ? "#define HAVE_INTRIN_H" : "/* */"],
            cmakedefine(true), // C_/D_ARITH_CODING_SUPPORTED
          ],
        },
        // jversion.h.in's only token is @COPYRIGHT_YEAR@ for the cjpeg banner.
        "jversion.h": { from: "src/jversion.h.in", replace: [["@COPYRIGHT_YEAR@", "2025"]] },
        ...(cfg.arm64
          ? {
              // All three vld1_* probes pass on every clang we ship (and are the
              // upstream gate for NEON_INTRINSICS=1), so resolve them all on.
              "neon-compat.h": { from: "simd/arm/neon-compat.h.in", replace: [["#cmakedefine", "#define"]] },
            }
          : {}),
      },
    };
  },

  provides: cfg => ({
    libs: [],
    // Public header is <turbojpeg.h> in src/; jconfig.h is generated into the
    // build dir, and jpeglib.h (included by turbojpeg.c callers that want the
    // low-level API) needs it.
    includes: ["src", depBuildDir(cfg, "libjpeg-turbo")],
  }),
};
