/**
 * libdeflate — fast deflate/gzip/zlib codec. Faster than zlib for one-shot
 * compression (no streaming). Used by Blob.gzip() and bun's .gz asset loader.
 *
 * DirectBuild: 11 .c files, no config.h, no codegen. The arm/x86 cpu_features
 * sources both compile on every target — they self-guard with #ifdef and the
 * inactive one becomes an empty TU.
 */

import type { Dependency } from "../source.ts";

const LIBDEFLATE_COMMIT = "c8c56a20f8f621e6a966b716b31f1dedab6a41e3";

export const libdeflate: Dependency = {
  name: "libdeflate",
  versionMacro: "LIBDEFLATE_HASH",

  source: () => ({
    kind: "github-archive",
    repo: "ebiggers/libdeflate",
    commit: LIBDEFLATE_COMMIT,
  }),

  build: () => ({
    kind: "direct",
    sources: [
      "lib/utils.c",
      "lib/arm/cpu_features.c",
      "lib/x86/cpu_features.c",
      "lib/deflate_compress.c",
      "lib/deflate_decompress.c",
      "lib/adler32.c",
      "lib/zlib_compress.c",
      "lib/zlib_decompress.c",
      "lib/crc32.c",
      "lib/gzip_compress.c",
      "lib/gzip_decompress.c",
    ],
    // libdeflate.h + common_defs.h live at the repo root; sources reach
    // lib/*.h by relative include from their own directory.
    includes: ["."],
  }),

  provides: () => ({
    libs: [],
    includes: ["."],
  }),
};
