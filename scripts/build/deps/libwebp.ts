/**
 * libwebp — Google's reference WebP codec. Backs Bun.Image WebP
 * decode/encode plus the SharpYUV RGB→YUV converter the encoder prefers.
 *
 * DirectBuild: no config.h, no codegen. Every dsp/*_{sse2,sse41,neon,msa,
 * mips}*.c file self-guards on WEBP_USE_<ISA> (derived from compiler arch
 * macros in src/dsp/cpu.h), so the off-target ones compile to empty TUs —
 * same pattern as libdeflate's arm/x86 cpu_features split. We list them all
 * and let the preprocessor prune.
 *
 * Threading: WEBP_USE_THREAD is left OFF. The decoder/encoder are invoked
 * from Bun's worker pool already; libwebp's internal pthread pool would just
 * oversubscribe.
 */

import type { Dependency } from "../source.ts";

const LIBWEBP_COMMIT = "b7e29b9d75bd31422b00c2a446d49d7af06c328d"; // v1.6.0

// prettier-ignore
const DEC = [
  "alpha_dec", "buffer_dec", "frame_dec", "idec_dec", "io_dec",
  "quant_dec", "tree_dec", "vp8_dec", "vp8l_dec", "webp_dec",
];

// prettier-ignore
const ENC = [
  "alpha_enc", "analysis_enc", "backward_references_cost_enc",
  "backward_references_enc", "config_enc", "cost_enc", "filter_enc",
  "frame_enc", "histogram_enc", "iterator_enc", "near_lossless_enc",
  "picture_enc", "picture_csp_enc", "picture_psnr_enc",
  "picture_rescale_enc", "picture_tools_enc", "predictor_enc",
  "quant_enc", "syntax_enc", "token_enc", "tree_enc", "vp8l_enc",
  "webp_enc",
];

// prettier-ignore
const DSP = [
  "alpha_processing", "alpha_processing_mips_dsp_r2",
  "alpha_processing_neon", "alpha_processing_sse2", "alpha_processing_sse41",
  "cost", "cost_mips32", "cost_mips_dsp_r2", "cost_neon", "cost_sse2",
  "cpu",
  "dec", "dec_clip_tables", "dec_mips32", "dec_mips_dsp_r2", "dec_msa",
  "dec_neon", "dec_sse2", "dec_sse41",
  "enc", "enc_mips32", "enc_mips_dsp_r2", "enc_msa", "enc_neon",
  "enc_sse2", "enc_sse41",
  "filters", "filters_mips_dsp_r2", "filters_msa", "filters_neon",
  "filters_sse2",
  "lossless", "lossless_avx2", "lossless_enc", "lossless_enc_avx2",
  "lossless_enc_mips32",
  "lossless_enc_mips_dsp_r2", "lossless_enc_msa", "lossless_enc_neon",
  "lossless_enc_sse2", "lossless_enc_sse41", "lossless_mips_dsp_r2",
  "lossless_msa", "lossless_neon", "lossless_sse2", "lossless_sse41",
  "rescaler", "rescaler_mips32", "rescaler_mips_dsp_r2", "rescaler_msa",
  "rescaler_neon", "rescaler_sse2",
  "ssim", "ssim_sse2",
  "upsampling", "upsampling_mips_dsp_r2", "upsampling_msa",
  "upsampling_neon", "upsampling_sse2", "upsampling_sse41",
  "yuv", "yuv_mips32", "yuv_mips_dsp_r2", "yuv_neon", "yuv_sse2",
  "yuv_sse41",
];

// prettier-ignore
const UTILS = [
  "bit_reader_utils", "bit_writer_utils", "color_cache_utils",
  "filters_utils", "huffman_encode_utils", "huffman_utils", "palette",
  "quant_levels_dec_utils", "quant_levels_utils", "random_utils",
  "rescaler_utils", "thread_utils", "utils",
];

// prettier-ignore
const SHARPYUV = [
  "sharpyuv", "sharpyuv_cpu", "sharpyuv_csp", "sharpyuv_dsp",
  "sharpyuv_gamma", "sharpyuv_neon", "sharpyuv_sse2",
];

// dsp/*_{sse2,sse41,avx2}.c each compile a single ISA variant. libwebp's
// cpu.h gates them on `__SSE2__`/`__SSE4_1__`/`__AVX2__` *or* `_MSC_VER` —
// real MSVC accepts AVX2 intrinsics without /arch, but clang-cl defines
// _MSC_VER and still requires `-mavx2`, so the file builds on Linux baseline
// (gate stays off) and explodes on Windows baseline (gate forced on, no ISA).
// Match upstream cmake/cpu.cmake: pass the ISA flag per-file. Runtime CPU
// dispatch in dsp/cpu.c picks the best available, so a baseline binary still
// runs on pre-AVX2 hardware.
function simd(path: string) {
  for (const [suf, flag] of [
    ["_avx2.c", "-mavx2"],
    ["_sse41.c", "-msse4.1"],
    ["_sse2.c", "-msse2"],
  ] as const) {
    if (path.endsWith(suf)) return { path, cflags: [flag] };
  }
  return path;
}

export const libwebp: Dependency = {
  name: "libwebp",
  versionMacro: "LIBWEBP",

  source: () => ({
    kind: "github-archive",
    repo: "webmproject/libwebp",
    commit: LIBWEBP_COMMIT,
  }),

  build: () => ({
    kind: "direct",
    sources: [
      ...DEC.map(f => `src/dec/${f}.c`),
      ...ENC.map(f => `src/enc/${f}.c`),
      ...DSP.map(f => simd(`src/dsp/${f}.c`)),
      ...UTILS.map(f => `src/utils/${f}.c`),
      ...SHARPYUV.map(f => simd(`sharpyuv/${f}.c`)),
    ],
    // src/webp/*.h is the public API; internal headers use "src/..."
    // includes from the repo root, sharpyuv uses "sharpyuv/...".
    includes: [".", "src"],
  }),

  provides: () => ({
    libs: [],
    includes: ["src"],
  }),
};
