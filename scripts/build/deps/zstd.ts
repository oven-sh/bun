/**
 * The sources of Zstandard in C, for programs that are not bun: `jsc` and
 * `testaot` where the ICU that they are linked with is that of a prebuilt
 * WebKit. Its data has a zstd frame an item, and these programs compile zstd's
 * decoder for themselves to read it (webkit.ts withZstdDecoder).
 *
 * No other build fetches it, nothing is built here, and it is one of
 * `programDeps`, not of `allDeps`: nothing of it reaches bun, whose zstd is
 * src/zstd.
 */

import type { Dependency } from "../source.ts";
import { jscPrograms } from "./webkit.ts";

const ZSTD_COMMIT = "f8745da6ff1ad1e7bab384bd1f9d742439278e99";

export const zstd: Dependency = {
  name: "zstd",

  enabled: cfg => jscPrograms(cfg).some(program => program.sourcesFrom?.includes("zstd")),

  source: () => ({
    kind: "github-archive",
    repo: "facebook/zstd",
    commit: ZSTD_COMMIT,
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({
    libs: [],
    includes: [],
  }),
};
