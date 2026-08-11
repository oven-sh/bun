/**
 * libwebp — Google's reference WebP codec. Backs Bun.Image WebP
 * decode/encode plus the SharpYUV RGB→YUV converter the encoder prefers.
 *
 * mux/demux are the RIFF-container helpers: demux reads VP8X chunks (ICCP,
 * EXIF, XMP) out of an input WebP without touching the bitstream; mux
 * wraps a raw VP8/VP8L encode in a VP8X container so those chunks can be
 * attached on output. Only the ICCP chunk is used today (ICC profile
 * carry-through for #30197), but the full mux/demux is linked since the
 * TUs are tiny and the EXIF/XMP chunks will need the same plumbing later.
 *
 * DirectBuild: no config.h, no codegen. Every dsp/*_{sse2,sse41,avx2,neon,
 * msa,mips}*.c file self-guards on WEBP_USE_<ISA> (derived from compiler arch
 * macros in src/dsp/cpu.h), so the off-target ones compile to empty TUs —
 * same pattern as libdeflate's arm/x86 cpu_features split. We list them all
 * and let the preprocessor prune. The x86 levels above the baseline need the
 * two-part wiring described at X86_ISAS below.
 *
 * Threading: WEBP_USE_THREAD is left OFF. Bun only uses the one-shot API
 * (WebPDecodeRGBA, WebPEncodeRGBA, WebPEncodeLosslessRGBA), which never
 * starts libwebp's worker threads either way; all the flag would add is a
 * mutex around each dsp init body, and only on non-Windows targets (cpu.h
 * drops it under _WIN32). The two init bodies that are not safe to run
 * concurrently are instead latched once from src/runtime/image/codec_webp.rs,
 * which covers every target.
 */

import type { Dependency, DirectSource } from "../source.ts";

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

// RIFF container read/write — extracts/attaches the ICCP chunk so a
// non-sRGB source (Display P3, Adobe RGB, Jpegli XYB) keeps its colour
// meaning through a WebP re-encode. `anim_decode.c`/`anim_encode.c`
// (WebPAnimDecoder/WebPAnimEncoder) are omitted: they layer ON TOP of
// demux/mux, not the reverse, and Bun has no animated-WebP support.
const DEMUX = ["demux"];
const MUX = ["muxedit", "muxinternal", "muxread"];

// prettier-ignore
const SHARPYUV = [
  "sharpyuv", "sharpyuv_cpu", "sharpyuv_csp", "sharpyuv_dsp",
  "sharpyuv_gamma", "sharpyuv_neon", "sharpyuv_sse2",
];

/**
 * x86 ISA levels libwebp ships kernels for. Each level is wired up in two
 * halves, the same split upstream's cmake/cpu.cmake and configure.ac make:
 *
 *   - The kernel TUs (dsp/*<suffix>) are compiled with `flag`. cpu.h turns
 *     the compiler's `__AVX2__` etc. into WEBP_USE_<ISA>, which the kernel
 *     file guards its body on; without it the file is just a stub Init.
 *     clang-cl needs the flag too: it defines _MSC_VER, which cpu.h reads as
 *     "MSVC, intrinsics work without /arch", so the kernel body is forced on.
 *   - Every TU gets `define` (WEBP_HAVE_<ISA>), which is what the dispatchers
 *     (dsp/lossless.c, lossless_enc.c, dec.c, ...) compile their
 *     `if (VP8GetCPUInfo(kAVX2)) VP8LDspInitAVX2();` under. Upstream sets
 *     these in config.h; without one, cpu.h derives WEBP_HAVE_<ISA> from each
 *     TU's own target, and the dispatchers are built at -march=nehalem. SSE2
 *     and SSE4.1 fell out of that, AVX2 did not, so on linux/darwin the AVX2
 *     kernels were linked in but never called. (clang-cl's _MSC_VER path
 *     implies all three, so on Windows these defines are a no-op; cpu.h only
 *     defines the ones that aren't already defined.)
 *
 * The define only says the kernels are linked in; the Init call stays behind
 * dsp/cpu.c's cpuid + xgetbv check, so the baseline binary still runs on
 * pre-AVX2 hardware. Neither half applies on arm64: the x86 kernel files
 * compile to stubs, the -m flags are invalid, and the dispatch blocks sit
 * under an SSE2 gate that is compiled out.
 */
const X86_ISAS = [
  { define: "WEBP_HAVE_AVX2", suffix: "_avx2.c", flag: "-mavx2" },
  { define: "WEBP_HAVE_SSE41", suffix: "_sse41.c", flag: "-msse4.1" },
  { define: "WEBP_HAVE_SSE2", suffix: "_sse2.c", flag: "-msse2" },
];

function simd(path: string, x64: boolean): string | DirectSource {
  if (!x64) return path;
  const isa = X86_ISAS.find(isa => path.endsWith(isa.suffix));
  return isa === undefined ? path : { path, cflags: [isa.flag] };
}

function x86Defines(x64: boolean): Record<string, true> {
  return x64 ? Object.fromEntries(X86_ISAS.map(isa => [isa.define, true])) : {};
}

export const libwebp: Dependency = {
  name: "libwebp",
  versionMacro: "LIBWEBP",

  source: () => ({
    kind: "github-archive",
    repo: "webmproject/libwebp",
    commit: LIBWEBP_COMMIT,
  }),

  build: cfg => ({
    kind: "direct",
    sources: [
      ...DEC.map(f => `src/dec/${f}.c`),
      ...ENC.map(f => `src/enc/${f}.c`),
      ...DSP.map(f => simd(`src/dsp/${f}.c`, cfg.x64)),
      ...UTILS.map(f => `src/utils/${f}.c`),
      ...DEMUX.map(f => `src/demux/${f}.c`),
      ...MUX.map(f => `src/mux/${f}.c`),
      ...SHARPYUV.map(f => simd(`sharpyuv/${f}.c`, cfg.x64)),
    ],
    defines: x86Defines(cfg.x64),
    // src/webp/*.h is the public API; internal headers use "src/..."
    // includes from the repo root, sharpyuv uses "sharpyuv/...".
    includes: [".", "src"],
  }),

  provides: () => ({
    libs: [],
    includes: ["src"],
  }),
};
