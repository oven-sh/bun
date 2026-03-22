/**
 * Zstandard — fast compression with a good ratio/speed tradeoff. Backs
 * bun's install cache and the `zstd` Content-Encoding in fetch.
 */

import type { Dependency } from "../source.ts";

const ZSTD_COMMIT = "f8745da6ff1ad1e7bab384bd1f9d742439278e99";

export const zstd: Dependency = {
  name: "zstd",
  versionMacro: "ZSTD_HASH",

  source: () => ({
    kind: "github-archive",
    repo: "facebook/zstd",
    commit: ZSTD_COMMIT,
  }),

  build: () => ({
    kind: "nested-cmake",
    targets: ["libzstd_static"],
    // zstd's repo root has a Makefile; the cmake build files live under
    // build/cmake/. (They support meson too — build/meson/ — but we stick
    // with cmake for consistency.)
    sourceSubdir: "build/cmake",
    args: {
      ZSTD_BUILD_STATIC: "ON",
      ZSTD_BUILD_PROGRAMS: "OFF",
      ZSTD_BUILD_TESTS: "OFF",
      ZSTD_BUILD_CONTRIB: "OFF",
    },
    libSubdir: "lib",
  }),

  provides: cfg => ({
    // Windows: cmake appends "_static" to distinguish from the DLL import lib.
    libs: [cfg.windows ? "zstd_static" : "zstd"],
    // Headers are in the SOURCE repo at lib/ (zstd.h, zdict.h).
    includes: ["lib"],
  }),
};
