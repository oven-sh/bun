/**
 * libjpeg-turbo — the de-facto JPEG codec. Backs Bun.Image JPEG
 * decode/encode via the high-level TurboJPEG API (turbojpeg.h).
 *
 * DirectBuild. SIMD: arm64 uses the full Neon intrinsics path (no GAS, no
 * jsimd_neon.S — clang has the complete vld1_* set so NEON_INTRINSICS=1 is
 * the upstream default there). x64 stays C-only for now; the x86_64 path is
 * NASM .asm and needs a separate wiring step. The hand-written jconfig.h/
 * jconfigint.h below replace cmake's configure_file — the only probes that
 * matter are sizeof(size_t) and __builtin_ctzl, both known per target.
 *
 * 12/16-bit sample depths and the lossless codec are compiled out
 * (turbojpeg.c gates them on `#ifdef NO_PRECISION_EXT`); Bun.Image only
 * deals in 8-bit RGB(A).
 */

import type { Dependency } from "../source.ts";
import { depBuildDir } from "../source.ts";

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

// `#cmakedefine X` → `#define X` / comment, configure_file-style. We resolve
// the handful of probes we know per target instead of running cmake.
const cmakedefine = (truthy: boolean): [string, string] => ["#cmakedefine", truthy ? "#define" : "// #undef"];

export const libjpegTurbo: Dependency = {
  name: "libjpeg-turbo",
  versionMacro: "LIBJPEG_TURBO",

  source: () => ({
    kind: "github-archive",
    repo: "libjpeg-turbo/libjpeg-turbo",
    commit: LIBJPEG_TURBO_COMMIT,
  }),

  patches: ["patches/libjpeg-turbo/8bit-only.patch", "patches/libjpeg-turbo/jbun_stubs.c"],

  build: cfg => {
    const simd = cfg.arm64; // x64 NASM path TODO
    const withSimd: [string, string] = [
      "#cmakedefine WITH_SIMD 1",
      simd ? "#define WITH_SIMD 1" : "/* #undef WITH_SIMD */",
    ];
    return {
      kind: "direct",
      sources: [
        ...JPEG8.map(f => `src/${f}.c`),
        ...TURBOJPEG.map(f => `src/${f}.c`),
        "jbun_stubs.c",
        ...(cfg.arm64 ? SIMD_ARM64.map(f => `simd/${f}.c`) : []),
      ],
      // simd/arm is needed for the bare `#include "align.h"` / `"neon-compat.h"`
      // in the intrinsics TUs; the generated neon-compat.h lands in depBuildDir,
      // which emitDirect already puts on the include path (jconfig.h relies on
      // the same).
      includes: ["src", ...(cfg.arm64 ? ["simd/arm"] : [])],
      defines: {
        BUN_8BIT_ONLY: true,
        ...(simd ? { NEON_INTRINSICS: true } : {}),
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
