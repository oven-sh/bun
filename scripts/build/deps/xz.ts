/**
 * XZ Utils — of which only liblzma is built: the LZMA1/LZMA2 codecs and the
 * .xz, .lzma and .lz containers. Backs Python's `lzma` module
 * (src/jsc/bindings/python/BunPythonLzma.cpp), and through it the xz modes of
 * `tarfile`, `zipfile` and `shutil`.
 *
 * DirectBuild: none of upstream's configure scripts, m4 macros or CMake files
 * run, and nothing outside src/liblzma and src/common is read. What their
 * probes would find out is written down below, per target.
 *
 * Left out:
 *   - Threads (stream_encoder_mt, stream_decoder_mt, outqueue,
 *     hardware_cputhreads, tuklib_cpucores): `lzma` has no use for them.
 *   - lzma_physmem() (hardware_physmem, tuklib_physmem).
 *   - The parts of the API that `lzma` does not reach: the one-shot buffer
 *     coders (*_buffer_encoder, *_buffer_decoder), *_memusage, file_info and
 *     index_decoder, MicroLZMA, filter chains as strings (string_conversion).
 *     A consumer that wants one adds it to SOURCES: they need no defines.
 *   - The table generators (*_tablegen, crc_clmul_consts_gen) and the
 *     size-optimized CRCs (crc32_small, crc64_small).
 */

import type { Dependency, DirectBuild } from "../source.ts";

// A release of the 5.8 line. Never 5.6.0 or 5.6.1 (CVE-2024-3094).
const XZ_COMMIT = "d3e650e63c110e830fd5391e7f8b45df0b91d3da"; // v5.8.4

// prettier-ignore
const SOURCES = [
  "check/check", "check/crc32_fast", "check/crc64_fast", "check/sha256",
  "common/alone_decoder", "common/alone_encoder", "common/auto_decoder",
  "common/block_decoder", "common/block_encoder", "common/block_header_decoder",
  "common/block_header_encoder", "common/block_util", "common/common",
  "common/easy_encoder", "common/easy_preset", "common/filter_common",
  "common/filter_decoder", "common/filter_encoder", "common/filter_flags_decoder",
  "common/filter_flags_encoder", "common/index", "common/index_encoder",
  "common/index_hash", "common/lzip_decoder", "common/stream_decoder",
  "common/stream_encoder", "common/stream_flags_common",
  "common/stream_flags_decoder", "common/stream_flags_encoder",
  "common/vli_decoder", "common/vli_encoder", "common/vli_size",
  "delta/delta_common", "delta/delta_decoder", "delta/delta_encoder",
  "lz/lz_decoder", "lz/lz_encoder", "lz/lz_encoder_mf",
  "lzma/fastpos_table", "lzma/lzma2_decoder", "lzma/lzma2_encoder",
  "lzma/lzma_decoder", "lzma/lzma_encoder", "lzma/lzma_encoder_optimum_fast",
  "lzma/lzma_encoder_optimum_normal", "lzma/lzma_encoder_presets",
  "rangecoder/price_table",
  "simple/arm", "simple/arm64", "simple/armthumb", "simple/ia64",
  "simple/powerpc", "simple/riscv", "simple/simple_coder",
  "simple/simple_decoder", "simple/simple_encoder", "simple/sparc", "simple/x86",
].map(s => `src/liblzma/${s}.c`);

const FILTERS = ["LZMA1", "LZMA2", "DELTA", "X86", "ARM", "ARMTHUMB", "ARM64", "POWERPC", "IA64", "SPARC", "RISCV"];

export const xz: Dependency = {
  name: "xz",

  source: () => ({
    kind: "github-archive",
    repo: "tukaani-project/xz",
    commit: XZ_COMMIT,
  }),

  build: cfg => {
    const defines: Record<string, number | true> = {
      HAVE_STDBOOL_H: true,
      HAVE__BOOL: true,
      HAVE_STDINT_H: true,
      HAVE_INTTYPES_H: true,

      HAVE_CHECK_CRC32: true,
      HAVE_CHECK_CRC64: true,
      HAVE_CHECK_SHA256: true,
      HAVE_MF_HC3: true,
      HAVE_MF_HC4: true,
      HAVE_MF_BT2: true,
      HAVE_MF_BT3: true,
      HAVE_MF_BT4: true,
      HAVE_ENCODERS: true,
      HAVE_DECODERS: true,
      // lzma_auto_decoder() takes .lz files too, as in the liblzma of every
      // distribution.
      HAVE_LZIP_DECODER: true,

      // clang, on every target.
      HAVE___BUILTIN_BSWAPXX: true,
      HAVE___BUILTIN_ASSUME_ALIGNED: true,
      // x64 and arm64 both read unaligned words at full speed.
      TUKLIB_FAST_UNALIGNED_ACCESS: true,
      // A static library exports nothing. (Read with #if, so it has to be 0.)
      HAVE_VISIBILITY: 0,
    };
    for (const filter of FILTERS) {
      defines[`HAVE_ENCODER_${filter}`] = true;
      defines[`HAVE_DECODER_${filter}`] = true;
    }

    // Not HAVE_FUNC_ATTRIBUTE_CONSTRUCTOR: it would pick the CRC functions in
    // two static initializers, a CPUID each in every start of bun. Without it
    // they are picked at the first call; BunPythonLzma.cpp makes that call
    // when the module is imported, before a second thread can.

    if (cfg.x64) {
      defines.HAVE_IMMINTRIN_H = true;
      defines.HAVE__MM_MOVEMASK_EPI8 = true;
      // CRC32 and CRC64 by carry-less multiplication, behind a CPUID check:
      // crc32_arch_optimized() and crc64_arch_optimized() have their own
      // __attribute__((target)), the files need no -m flags. Both are in
      // scripts/verify-baseline-static/allowlist-x64*.txt.
      defines.HAVE_USABLE_CLMUL = true;
      // With _MSC_VER defined the sources use <intrin.h> instead.
      if (!cfg.windows) defines.HAVE_CPUID_H = true;
    } else if (cfg.arm64) {
      // The CRC32 instructions, which the baseline (armv8-a+crc) has: then
      // __ARM_FEATURE_CRC32 is defined and nothing is detected at run time.
      // The rest says how to detect them should the baseline lose them. On
      // Windows the sources expect MSVC's <intrin.h> to declare __crc32d(),
      // which clang-cl's does not: there the tables are used.
      if (!cfg.windows) defines.HAVE_ARM64_CRC32 = true;
      if (cfg.linux) {
        defines.HAVE_GETAUXVAL = true;
        defines.HAVE_HWCAP_CRC32 = true;
      } else if (cfg.freebsd) {
        defines.HAVE_ELF_AUX_INFO = true;
      } else if (cfg.darwin) {
        defines.HAVE_SYSCTLBYNAME = true;
      }
    } else {
      throw new Error(`xz: nothing is known about arch ${cfg.arch}`);
    }

    const spec: DirectBuild = {
      kind: "direct",
      sources: SOURCES,
      defines,
      includes: [
        "src/liblzma/api",
        "src/liblzma/common",
        "src/liblzma/check",
        "src/liblzma/lz",
        "src/liblzma/rangecoder",
        "src/liblzma/lzma",
        "src/liblzma/delta",
        "src/liblzma/simple",
        "src/common",
      ],
    };
    return spec;
  },

  // Whoever includes <lzma.h> on Windows defines LZMA_API_STATIC first: without
  // it the functions are declared as imports of a DLL.
  provides: () => ({
    libs: [],
    includes: ["src/liblzma/api"],
  }),
};
