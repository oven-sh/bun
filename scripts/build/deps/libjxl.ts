/**
 * libjxl — the JPEG XL reference library. Backs Bun.Image's `.jxl()`
 * encoder. Decoding goes through jxl-rs (the `jxl` crate) instead: it is
 * memory-safe on untrusted input and is the decoder Chrome and Firefox ship.
 *
 * DirectBuild of the encoder plus the decoder internals it is built on
 * (enc_*.cc reads back through dec_*.cc for its own quality loops). The
 * public JxlDecoder API (decode.cc), JPEG reconstruction (decode_to_jpeg.cc,
 * dec_jpeg_*.cc) and box decoding are left out, so nothing in Bun can reach
 * libjxl's decoder by accident. jpeg/jpeg_data.cc stays: encode.cc links
 * JPEGData for JxlEncoderAddJPEGFrame.
 *
 * Highway and Brotli come from Bun's own vendored copies (brotli is the same
 * v1.2.0 commit libjxl pins); the CMS is skcms (deps/skcms.ts). No thread
 * pool (jxl_threads): encodes already run on Bun's WorkPool, the same reason
 * libwebp is built without WEBP_USE_THREAD.
 */

import type { Dependency } from "../source.ts";
import { depSourceDir } from "../source.ts";
import { disabledTargets } from "./highway.ts";

const LIBJXL_COMMIT = "a7a9c787341cf703dede03c2009fa460cae5e5df"; // v0.12.0
const [MAJOR, MINOR, PATCH] = [0, 12, 0];

// lib/jxl_lists.cmake JPEGXL_INTERNAL_DEC_SOURCES, minus decode.cc.
// prettier-ignore
const DEC = [
  "ac_strategy", "alpha", "ans_common", "blending", "chroma_from_luma",
  "coeff_order", "color_encoding_internal", "compressed_dc", "convolve_slow",
  "convolve_symmetric5", "dct_scales", "dec_ans", "dec_bit_reader", "dec_cache",
  "dec_context_map", "dec_external_image", "dec_frame", "dec_group",
  "dec_group_border", "dec_huffman", "dec_modular", "dec_noise",
  "dec_patch_dictionary", "dec_xyb", "entropy_coder", "epf", "fields",
  "frame_header", "headers", "huffman_table", "icc_codec", "icc_codec_common",
  "image", "image_bundle", "image_metadata", "image_ops", "loop_filter",
  "luminance", "memory_manager_internal", "opsin_params", "passes_state",
  "quant_weights", "quantizer", "simd_util", "splines", "toc",
  "jpeg/jpeg_data",
  "modular/encoding/dec_ma", "modular/encoding/encoding",
  "modular/modular_image", "modular/transform/palette", "modular/transform/rct",
  "modular/transform/squeeze", "modular/transform/squeeze_params",
  "modular/transform/transform",
  "render_pipeline/low_memory_render_pipeline", "render_pipeline/render_pipeline",
  "render_pipeline/render_pipeline_stage", "render_pipeline/simple_render_pipeline",
  "render_pipeline/stage_blending", "render_pipeline/stage_chroma_upsampling",
  "render_pipeline/stage_cms", "render_pipeline/stage_epf",
  "render_pipeline/stage_from_linear", "render_pipeline/stage_gaborish",
  "render_pipeline/stage_noise", "render_pipeline/stage_patches",
  "render_pipeline/stage_splines", "render_pipeline/stage_spot",
  "render_pipeline/stage_to_linear", "render_pipeline/stage_tone_mapping",
  "render_pipeline/stage_upsampling", "render_pipeline/stage_write",
  "render_pipeline/stage_xyb", "render_pipeline/stage_ycbcr",
];

// lib/jxl_lists.cmake JPEGXL_INTERNAL_ENC_SOURCES.
// prettier-ignore
const ENC = [
  "butteraugli/butteraugli", "enc_ac_strategy", "enc_adaptive_quantization",
  "enc_ans", "enc_ans_simd", "enc_aux_out", "enc_bit_writer",
  "enc_butteraugli_comparator", "enc_cache", "enc_chroma_from_luma",
  "enc_cluster", "enc_coeff_order", "enc_comparator", "enc_context_map",
  "enc_convolve_separable5", "enc_debug_image", "enc_detect_dots",
  "enc_dot_dictionary", "enc_entropy_coder", "enc_external_image",
  "enc_fast_lossless", "enc_fields", "enc_frame", "enc_gaborish", "enc_group",
  "enc_heuristics", "enc_huffman", "enc_huffman_tree", "enc_icc_codec",
  "enc_image_bundle", "enc_linalg", "enc_lz77", "enc_modular",
  "enc_modular_simd", "enc_noise", "enc_patch_dictionary", "enc_photon_noise",
  "enc_progressive_split", "enc_quant_weights", "enc_splines", "enc_toc",
  "enc_transforms", "enc_xyb", "encode",
  "jpeg/enc_jpeg_data", "jpeg/enc_jpeg_data_reader", "jpeg/enc_jpeg_huffman_decode",
  "modular/encoding/enc_debug_tree", "modular/encoding/enc_encoding",
  "modular/encoding/enc_ma", "modular/transform/enc_palette",
  "modular/transform/enc_rct", "modular/transform/enc_squeeze",
  "modular/transform/enc_transform",
];

// cmake's generate_export_header output, reduced to the static-library case.
const exportHeader = (base: string) => `#ifndef ${base}_EXPORT_H
#define ${base}_EXPORT_H
#define ${base}_EXPORT
#define ${base}_NO_EXPORT
#ifndef ${base}_DEPRECATED
#define ${base}_DEPRECATED __attribute__((__deprecated__))
#endif
#endif
`;

export const libjxl: Dependency = {
  name: "libjxl",

  source: () => ({
    kind: "github-archive",
    repo: "libjxl/libjxl",
    commit: LIBJXL_COMMIT,
  }),

  // Overlay: the flat C entry point codec_jxl.rs calls.
  patches: ["patches/libjxl/bun_jxl_encode.cc"],

  fetchDeps: ["highway", "brotli", "skcms"],

  build: cfg => ({
    kind: "direct",
    lang: "cxx",
    sources: [...[...DEC, ...ENC, "cms/jxl_cms"].map(s => `lib/jxl/${s}.cc`), "bun_jxl_encode.cc"],
    // Sources include "lib/jxl/…" from the repo root and <jxl/…> from lib/include.
    includes: [
      ".",
      "lib/include",
      depSourceDir(cfg, "highway"),
      depSourceDir(cfg, "brotli") + "/c/include",
      depSourceDir(cfg, "skcms"),
    ],
    defines: {
      JXL_STATIC_DEFINE: true,
      JXL_CMS_STATIC_DEFINE: true,
      JPEGXL_ENABLE_SKCMS: 1,
    },
    // Upstream's lib/CMakeLists.txt sets the same exception/errno flags;
    // highway.ts carries the clang-cl spelling for Windows.
    cflags: [
      `-D${disabledTargets}`,
      ...(cfg.windows
        ? ["-D_HAS_EXCEPTIONS=0"]
        : ["-fno-exceptions", "-fmath-errno", "-fno-builtin-fwrite", "-fno-builtin-fread"]),
    ],
    headers: {
      "jxl/version.h": {
        from: "lib/jxl/version.h.in",
        replace: [
          ["@JPEGXL_MAJOR_VERSION@", String(MAJOR)],
          ["@JPEGXL_MINOR_VERSION@", String(MINOR)],
          ["@JPEGXL_PATCH_VERSION@", String(PATCH)],
        ],
      },
      "jxl/jxl_export.h": exportHeader("JXL"),
      "jxl/jxl_cms_export.h": exportHeader("JXL_CMS"),
    },
  }),

  provides: () => ({
    libs: [],
    includes: ["lib/include"],
  }),
};
