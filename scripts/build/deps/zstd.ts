/**
 * Zstandard — fast compression with a good ratio/speed tradeoff. Backs
 * bun's install cache and the `zstd` Content-Encoding in fetch.
 *
 * DirectBuild: globbed common/compress/decompress/dictBuilder + the legacy
 * decoders (parity with cmake's ZSTD_LEGACY_SUPPORT default). The amd64
 * Huffman kernel ships as a .S file that clang assembles directly; on other
 * targets ZSTD_DISABLE_ASM falls through to the C implementation.
 */

import type { Dependency, DirectBuild } from "../source.ts";

const ZSTD_COMMIT = "f8745da6ff1ad1e7bab384bd1f9d742439278e99";

// prettier-ignore
const SOURCES = [
  "common/debug", "common/entropy_common", "common/error_private",
  "common/fse_decompress", "common/pool", "common/threading", "common/xxhash",
  "common/zstd_common",
  "compress/fse_compress", "compress/hist", "compress/huf_compress",
  "compress/zstd_compress", "compress/zstd_compress_literals",
  "compress/zstd_compress_sequences", "compress/zstd_compress_superblock",
  "compress/zstd_double_fast", "compress/zstd_fast", "compress/zstd_lazy",
  "compress/zstd_ldm", "compress/zstd_opt", "compress/zstd_preSplit",
  "compress/zstdmt_compress",
  "decompress/huf_decompress", "decompress/zstd_ddict",
  "decompress/zstd_decompress", "decompress/zstd_decompress_block",
  "dictBuilder/cover", "dictBuilder/divsufsort", "dictBuilder/fastcover",
  "dictBuilder/zdict",
  // ZSTD_LEGACY_SUPPORT=5 → zstd_legacy.h only dispatches to v05+;
  // v01–v04 would compile but never be reached. cmake's build does the
  // same (it loops `RANGE ZSTD_LEGACY_LEVEL 7`).
  "legacy/zstd_v05", "legacy/zstd_v06", "legacy/zstd_v07",
].map(s => `lib/${s}.c`);

export const zstd: Dependency = {
  name: "zstd",
  versionMacro: "ZSTD_HASH",

  source: () => ({
    kind: "github-archive",
    repo: "facebook/zstd",
    commit: ZSTD_COMMIT,
  }),

  build: cfg => {
    const sources = [...SOURCES];
    const defines: Record<string, number | true> = {
      ZSTD_MULTITHREAD: true,
      ZSTD_LEGACY_SUPPORT: 5,
    };

    // huf_decompress_amd64.S is GNU-as syntax. clang assembles it on
    // posix x64; clang-cl can't, so Windows takes the C path.
    if (cfg.x64 && !cfg.windows) {
      sources.push("lib/decompress/huf_decompress_amd64.S");
    } else {
      defines.ZSTD_DISABLE_ASM = 1;
    }

    const spec: DirectBuild = {
      kind: "direct",
      sources,
      defines,
      includes: ["lib", "lib/common", "lib/legacy"],
      pic: true,
      // XXH_NAMESPACE must be a bare token prefix (xxhash pastes it onto
      // symbol names), not a string literal — DirectBuild.defines would
      // wrap it in quotes. Avoids clashes with lshpack/libarchive's copies.
      cflags: ["-DXXH_NAMESPACE=ZSTD_"],
    };
    return spec;
  },

  provides: () => ({
    libs: [],
    includes: ["lib"],
  }),
};
