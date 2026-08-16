/**
 * picohttpparser — tiny HTTP parser. Single .c file, no build system.
 *
 * No `.a` produced — bun compiles `picohttpparser.c` directly into its
 * binary. `provides.sources` tells the build system which files; they're
 * declared as implicit outputs of the fetch rule so ninja knows they
 * exist once fetch completes (otherwise: "missing and no known rule to
 * make it" on fresh checkouts).
 */

import type { Dependency } from "../source.ts";

const PICOHTTPPARSER_COMMIT = "066d2b1e9ab820703db0837a7255d92d30f0c9f5";

export const picohttpparser: Dependency = {
  name: "picohttpparser",
  versionMacro: "PICOHTTPPARSER",

  source: () => ({
    kind: "github-archive",
    repo: "h2o/picohttpparser",
    commit: PICOHTTPPARSER_COMMIT,
  }),

  build: () => ({ kind: "none" }),

  provides: () => ({
    libs: [],
    includes: ["."],
    sources: ["picohttpparser.c"],
  }),
};
