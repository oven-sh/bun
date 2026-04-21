/**
 * libdeflate — fast deflate/gzip/zlib codec. Faster than zlib for one-shot
 * compression (no streaming). Used by Blob.gzip() and bun's .gz asset loader.
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
    kind: "nested-cmake",
    targets: ["libdeflate_static"],
    args: {
      LIBDEFLATE_BUILD_STATIC_LIB: "ON",
      LIBDEFLATE_BUILD_SHARED_LIB: "OFF",
      LIBDEFLATE_BUILD_GZIP: "OFF",
    },
  }),

  // Windows output is `deflatestatic.lib`, unix is `libdeflate.a`. Same code,
  // different naming because libdeflate's CMakeLists uses a target-specific
  // OUTPUT_NAME on win32 (avoids the windows convention of prefixing "lib").
  provides: cfg => ({
    libs: [cfg.windows ? "deflatestatic" : "deflate"],
    includes: ["."],
  }),
};
