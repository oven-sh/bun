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

const BROTLI_COMMIT = "028fb5a23661f123017c060daa546b55cf4bde29"; // v1.2.0

// prettier-ignore
const SOURCES = [
  "common/constants", "common/context", "common/dictionary", "common/platform",
  "common/shared_dictionary", "common/transform",
  "dec/bit_reader", "dec/decode", "dec/huffman", "dec/prefix", "dec/state",
  "dec/static_init",
  "enc/backward_references", "enc/backward_references_hq", "enc/bit_cost",
  "enc/block_splitter", "enc/brotli_bit_stream", "enc/cluster", "enc/command",
  "enc/compound_dictionary", "enc/compress_fragment", "enc/compress_fragment_two_pass",
  "enc/dictionary_hash", "enc/encode", "enc/encoder_dict", "enc/entropy_encode",
  "enc/fast_log", "enc/histogram", "enc/literal_cost", "enc/memory",
  "enc/metablock", "enc/static_dict", "enc/static_dict_lut", "enc/static_init",
  "enc/utf8_util",
];

export const brotli: Dependency = {
  name: "brotli",

  source: () => ({
    kind: "github-archive",
    repo: "google/brotli",
    commit: BROTLI_COMMIT,
  }),

  build: () => {
    const spec: DirectBuild = {
      kind: "direct",
      sources: SOURCES.map(s => `c/${s}.c`),
      includes: ["c/include"],
      pic: true,
    };

    return spec;
  },

  provides: () => ({
    libs: [],
    includes: ["c/include"],
  }),
};
