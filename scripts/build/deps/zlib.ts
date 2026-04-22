/**
 * zlib-ng — next-generation zlib with SIMD-accelerated CRC, adler32, hash,
 * and chunk operations across SSE2/AVX2/AVX512/NEON. Runtime CPU detection
 * picks the fastest path. Backs node:zlib and gzip Content-Encoding.
 *
 * Built in ZLIB_COMPAT mode so the ABI matches stock zlib (z_stream layout,
 * deflateInit_/inflateInit_ symbols).
 *
 * DirectBuild structure:
 *   - CORE + GENERIC are the portable C, compiled with the dep's shared flags.
 *   - Each SIMD kernel compiles with its own `-m<isa>` flag so the rest of
 *     the library doesn't accidentally emit AVX in non-dispatched code.
 *     functable.c picks the right kernel at process start via cpuid/auxv.
 *   - zlib.h / zconf.h come from .h.in templates by literal substitution
 *     (the only thing cmake's configure_file did here).
 */

import type { Dependency, DirectBuild, DirectSource } from "../source.ts";
import { depBuildDir } from "../source.ts";

// Pin to a release tag, not develop. Two regressions landed on develop AFTER
// 2.3.3 that are NOT present at this commit — re-audit before bumping past it:
//   - 172b8544 (Apr 2026): inverted COPY guard disables Chorba CRC32 fast-path
//     on PCLMULQDQ-only x64 (Westmere–Comet Lake, Zen1–Zen3)
//   - e5129cfe (Jan 2026): deflateBound() hits __builtin_unreachable() after
//     Z_FINISH (s->wrap negated to -1/-2, switch falls to default)
const ZLIB_COMMIT = "12731092979c6d07f42da27da673a9f6c7b13586"; // 2.3.3

// prettier-ignore
const CORE = [
  "adler32", "compress", "crc32", "crc32_braid_comb",
  "deflate", "deflate_fast", "deflate_huff", "deflate_medium", "deflate_quick",
  "deflate_rle", "deflate_slow", "deflate_stored",
  "functable", "infback", "inflate", "inftrees",
  "insert_string", "insert_string_roll", "trees", "uncompr", "zutil",
  "cpu_features", "gzlib", "gzread", "gzwrite",
  // Generic Chorba CRC: included on every arch even with SIMD enabled — the
  // PCLMUL/NEON paths don't subsume it, functable falls back here on CPUs
  // without carryless multiply.
  "arch/generic/crc32_chorba_c",
];

// Portable kernel implementations. functable.c needs at least one symbol per
// op to fall back to. On x64 SSE2 is the architectural baseline so chunkset/
// compare256/slide_hash use the SSE2 kernel as the fallback and these three
// are dropped — see x64Generic().
// prettier-ignore
const GENERIC = [
  "adler32_c", "adler32_fold_c", "chunkset_c", "compare256_c",
  "crc32_braid_c", "crc32_fold_c", "slide_hash_c",
];

/**
 * One ISA level: a feature define for functable.c, the `-m` flag(s) the
 * kernel sources need, and the kernel sources themselves.
 *
 * `-fno-lto` on every kernel mirrors cmake's NOLTOFLAG: ThinLTO can hoist
 * an AVX intrinsic into a caller that runs before the cpuid dispatch and
 * SIGILL on older CPUs. Keeping kernels in their own non-LTO TU is the
 * upstream-recommended boundary.
 */
interface SimdKernel {
  define: string;
  flags: string[];
  sources: string[];
}

// clang-cl accepts gcc-spelling `-m<isa>` flags, so one table covers Windows
// too. cmake's detect-intrinsics.cmake branches on MSVC only to use `/arch:`
// for cl.exe proper.
const X86: SimdKernel[] = [
  {
    define: "X86_SSE2",
    flags: ["-msse2"],
    sources: ["chunkset_sse2", "chorba_sse2", "compare256_sse2", "slide_hash_sse2"],
  },
  { define: "X86_SSSE3", flags: ["-mssse3"], sources: ["adler32_ssse3", "chunkset_ssse3"] },
  { define: "X86_SSE41", flags: ["-msse4.1"], sources: ["chorba_sse41"] },
  { define: "X86_SSE42", flags: ["-msse4.2"], sources: ["adler32_sse42"] },
  { define: "X86_PCLMULQDQ_CRC", flags: ["-msse4.2", "-mpclmul"], sources: ["crc32_pclmulqdq"] },
  {
    define: "X86_AVX2",
    flags: ["-mavx2", "-mbmi2"],
    sources: ["slide_hash_avx2", "chunkset_avx2", "compare256_avx2", "adler32_avx2"],
  },
  {
    define: "X86_AVX512",
    flags: ["-mavx512f", "-mavx512dq", "-mavx512bw", "-mavx512vl", "-mbmi2"],
    sources: ["adler32_avx512", "chunkset_avx512", "compare256_avx512"],
  },
  {
    define: "X86_AVX512VNNI",
    flags: ["-mavx512f", "-mavx512dq", "-mavx512bw", "-mavx512vl", "-mavx512vnni", "-mbmi2"],
    sources: ["adler32_avx512_vnni"],
  },
  {
    define: "X86_VPCLMULQDQ_CRC",
    flags: ["-mpclmul", "-mvpclmulqdq", "-mavx512f", "-mavx512dq", "-mavx512bw", "-mavx512vl", "-mbmi2"],
    sources: ["crc32_vpclmulqdq"],
  },
];

// aarch64: NEON and CRC32 are both armv8-a baseline for our targets, so the
// "runtime detection" still happens but always finds them. ARMv6 SIMD is
// 32-bit only and we don't ship arm32.
const ARM: SimdKernel[] = [
  {
    define: "ARM_NEON",
    flags: ["-march=armv8-a+simd"],
    sources: ["adler32_neon", "chunkset_neon", "compare256_neon", "slide_hash_neon"],
  },
  { define: "ARM_CRC32", flags: ["-march=armv8-a+crc"], sources: ["crc32_armv8"] },
];

/** SSE2 is the x64 fallback floor, so drop the scalar kernels it subsumes. */
function x64Generic(): string[] {
  const subsumed = new Set(["chunkset_c", "compare256_c", "slide_hash_c"]);
  return GENERIC.filter(s => !subsumed.has(s));
}

export const zlib: Dependency = {
  name: "zlib",
  versionMacro: "ZLIB_HASH",

  source: () => ({
    kind: "github-archive",
    repo: "zlib-ng/zlib-ng",
    commit: ZLIB_COMMIT,
  }),

  patches: [
    // clang-cl defines _MSC_VER but needs clang's <arm_neon.h>/<arm_acle.h>,
    // not MSVC's <arm64_neon.h>/<intrin.h>. Upstream gates on _MSC_VER alone.
    "patches/zlib/clang-cl-arm64.patch",
  ],

  build: cfg => {
    const sources: Array<string | DirectSource> = CORE.map(s => `${s}.c`);

    const defines: Record<string, number | true> = {
      ZLIB_COMPAT: true,
      WITH_GZFILEOP: true,
      // Gates the entire SIMD dispatch block in functable.c. Without it the
      // arch kernels compile but are never selected.
      WITH_OPTIM: true,
      // zlib-ng 340f2f6e moved infback.c's distance-too-far-back check behind
      // INFLATE_STRICT (default OFF). Upstream zlib has it unconditional. Bun
      // doesn't call inflateBack(), but anything in-process linking the same
      // lib could read adjacent heap on a malicious raw-deflate stream with
      // windowBits<15. Hardens at zero perf cost to inflate() proper.
      INFLATE_STRICT: true,
      // clang has all of these on every target we ship; cmake's
      // check_c_source_compiles probes are pure overhead for us.
      HAVE_ATTRIBUTE_ALIGNED: true,
      HAVE_BUILTIN_ASSUME_ALIGNED: true,
      HAVE_BUILTIN_CTZ: true,
      HAVE_BUILTIN_CTZLL: true,
      ...(cfg.windows
        ? { _CRT_SECURE_NO_WARNINGS: true, _CRT_NONSTDC_NO_WARNINGS: true }
        : {
            HAVE_VISIBILITY_HIDDEN: true,
            HAVE_VISIBILITY_INTERNAL: true,
            HAVE_POSIX_MEMALIGN: true,
            _LARGEFILE64_SOURCE: 1,
            __USE_LARGEFILE64: true,
          }),
      ...(cfg.linux && { HAVE_SYS_AUXV_H: true }),
    };

    // ─── Per-arch SIMD kernels ───
    // Exhaustive on Arch — if a new arch is added to Config, this fails
    // loudly at configure time instead of silently using arm sources.
    let kernels: SimdKernel[];
    let archDir: string;
    if (cfg.x64) {
      kernels = X86;
      archDir = "x86";
      defines.X86_FEATURES = true;
      defines.X86_HAVE_XSAVE_INTRIN = true;
      // clang-cl ships <intrin.h> with MS-style __cpuid; everywhere else
      // <cpuid.h> with __cpuid_count.
      if (cfg.windows) defines.HAVE_CPUID_MS = true;
      else defines.HAVE_CPUID_GNU = true;
      sources.push(...x64Generic().map(s => `arch/generic/${s}.c`));
      sources.push({ path: "arch/x86/x86_features.c", cflags: ["-mxsave"] });
    } else if (cfg.arm64) {
      kernels = ARM;
      archDir = "arm";
      defines.ARM_FEATURES = true;
      defines.ARM_NEON_HASLD4 = true;
      defines.ARM_CRC32_INTRIN = true;
      defines.HAVE_ARM_ACLE_H = true;
      defines.WITH_ALL_FALLBACKS = true;
      if (cfg.windows) defines.__ARM_NEON__ = true;
      if (cfg.linux) {
        defines.ARM_AUXV_HAS_NEON = true;
        defines.HAVE_LINUX_AUXVEC_H = true;
      }
      sources.push(...GENERIC.map(s => `arch/generic/${s}.c`));
      sources.push("arch/arm/arm_features.c");
    } else {
      throw new Error(`zlib: no SIMD kernel table for arch ${cfg.arch}`);
    }

    for (const k of kernels) {
      defines[k.define] = true;
      for (const s of k.sources) {
        sources.push({ path: `arch/${archDir}/${s}.c`, cflags: [...k.flags, "-fno-lto"] });
      }
    }

    const spec: DirectBuild = {
      kind: "direct",
      sources,
      defines,
      includes: [".", "arch/generic", `arch/${archDir}`],
      headers: {
        "zlib.h": { from: "zlib.h.in", replace: [["@ZLIB_SYMBOL_PREFIX@", ""]] },
        "zconf.h": {
          from: "zconf.h.in",
          replace: [
            ["#ifdef HAVE_UNISTD_H ", cfg.windows ? "#if 0 " : "#if 1 "],
            ["#ifdef NEED_PTRDIFF_T ", "#if 0 "],
          ],
        },
        "gzread_mangle.h": "#undef gzgetc\n#undef zng_gzgetc\n",
        "zlib_name_mangling.h": "#ifndef ZLIB_NAME_MANGLING_H\n#define ZLIB_NAME_MANGLING_H\n#endif\n",
      },
    };
    return spec;
  },

  // The substituted zlib.h / zconf.h land in the build dir, not the source
  // tree, so consumers (libarchive, bun's own bindings) include from there.
  provides: cfg => ({
    libs: [],
    includes: [depBuildDir(cfg, "zlib")],
  }),
};
