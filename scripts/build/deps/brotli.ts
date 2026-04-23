/**
 * Brotli — high-ratio compression. Backs the `br` Content-Encoding in fetch
 * and bun's --compress bundler flag.
 *
 * DirectBuild: one archive containing common + dec + enc. The cmake build
 * splits these into three libs purely so dec-only consumers can avoid the
 * encoder; we link everything anyway, so a single .a is simpler and drops
 * the "common must come last" link-order footgun.
 */

import type { Dependency, DirectBuild } from "../source.ts";

// Upstream brotli pins releases by tag, not commit. A retag would change
// what we fetch — if that ever matters, resolve the tag to a sha and pin that.
const BROTLI_COMMIT = "v1.1.0";

// prettier-ignore
const SOURCES = [
  "common/constants", "common/context", "common/dictionary", "common/platform",
  "common/shared_dictionary", "common/transform",
  "dec/bit_reader", "dec/decode", "dec/huffman", "dec/state",
  "enc/backward_references", "enc/backward_references_hq", "enc/bit_cost",
  "enc/block_splitter", "enc/brotli_bit_stream", "enc/cluster", "enc/command",
  "enc/compound_dictionary", "enc/compress_fragment", "enc/compress_fragment_two_pass",
  "enc/dictionary_hash", "enc/encode", "enc/encoder_dict", "enc/entropy_encode",
  "enc/fast_log", "enc/histogram", "enc/literal_cost", "enc/memory",
  "enc/metablock", "enc/static_dict", "enc/utf8_util",
];

export const brotli: Dependency = {
  name: "brotli",

  source: () => ({
    kind: "github-archive",
    repo: "google/brotli",
    commit: BROTLI_COMMIT,
  }),

  build: cfg => {
    const spec: DirectBuild = {
      kind: "direct",
      sources: SOURCES.map(s => `c/${s}.c`),
      includes: ["c/include"],
      // log2 exists everywhere we target; the cmake check only exists for
      // ancient bionic. OS_* selects the <endian.h> include in platform.h;
      // Windows is detected via _WIN32 directly so needs no define here.
      defines: {
        BROTLI_HAVE_LOG2: 1,
        ...(cfg.linux && { OS_LINUX: true }),
        ...(cfg.darwin && { OS_MACOSX: true }),
      },
      pic: true,
    };

    // LTO miscompile: on linux-x64 with AVX (non-baseline), BrotliDecompress
    // errors out mid-stream. Root cause unknown — likely an alias-analysis
    // issue around brotli's ring-buffer copy hoisting. -fno-lto sidesteps it.
    // Linux-only: clang's LTO on darwin/windows has a different codepath.
    // x64+non-baseline only: the SSE/AVX path is where the miscompile lives;
    // baseline (SSE2-only) doesn't hit it.
    if (cfg.linux && cfg.x64 && !cfg.baseline) {
      spec.cflags = ["-fno-lto"];
    }

    return spec;
  },

  provides: () => ({
    libs: [],
    includes: ["c/include"],
  }),
};
